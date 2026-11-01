import "server-only";

import type { ChatRequest, GenerationStats, StreamEvent } from "@/lib/types";
import { ollamaError, ollamaFetch } from "./ollama";
import { getProvider, splitModelId, type ProviderConfig } from "./providers";

type Emit = (event: StreamEvent) => void;

interface Tracker {
  emit: Emit;
  mark: () => void;
  finish: (extra?: Partial<GenerationStats>) => void;
}

function createTracker(send: Emit): Tracker {
  const startedAt = performance.now();
  let firstAt: number | undefined;
  let finished = false;
  return {
    emit: send,
    mark() {
      firstAt ??= performance.now();
    },
    finish(extra = {}) {
      if (finished) return;
      finished = true;
      const end = performance.now();
      const stats: GenerationStats = {
        totalMs: Math.round(end - startedAt),
        ttftMs: firstAt === undefined ? undefined : Math.round(firstAt - startedAt),
        ...extra,
      };
      if (stats.tokensPerSecond === undefined && stats.outputTokens && firstAt !== undefined) {
        const seconds = (end - firstAt) / 1000;
        if (seconds > 0.05) stats.tokensPerSecond = stats.outputTokens / seconds;
      }
      send({ type: "done", stats });
    },
  };
}

async function* readLines(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index: number;
      while ((index = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, index).replace(/\r$/, "");
        buffer = buffer.slice(index + 1);
        if (line) yield line;
      }
    }
    buffer += decoder.decode();
    if (buffer.trim()) yield buffer.trim();
  } finally {
    reader.releaseLock();
  }
}

async function* readSse(body: ReadableStream<Uint8Array>) {
  for await (const line of readLines(body)) {
    if (!line.startsWith("data:")) continue;
    const data = line.slice(5).trim();
    if (data === "[DONE]") return;
    try {
      yield JSON.parse(data) as Record<string, unknown>;
    } catch {}
  }
}

function withSystem(req: ChatRequest) {
  const system = req.system?.trim();
  const messages = req.messages.filter((m) => m.role !== "system");
  return system ? [{ role: "system" as const, content: system }, ...messages] : messages;
}

async function errorText(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof data.error === "string") return data.error;
    if (data.error?.message) return data.error.message;
    if (data.message) return data.message;
  } catch {}
  return text.slice(0, 300) || `请求失败（${res.status}）`;
}

async function runOllama(name: string, req: ChatRequest, signal: AbortSignal, t: Tracker) {
  const body: Record<string, unknown> = { model: name, messages: withSystem(req), stream: true };
  if (req.temperature !== undefined) body.options = { temperature: req.temperature };
  if (req.think === "on") body.think = true;
  if (req.think === "off") body.think = false;

  const res = await ollamaFetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await ollamaError(res));

  for await (const line of readLines(res.body)) {
    const chunk = JSON.parse(line) as {
      error?: string;
      message?: { content?: string; thinking?: string };
      done?: boolean;
      eval_count?: number;
      eval_duration?: number;
      prompt_eval_count?: number;
    };
    if (chunk.error) throw new Error(chunk.error);
    if (chunk.message?.thinking) {
      t.mark();
      t.emit({ type: "thinking", content: chunk.message.thinking });
    }
    if (chunk.message?.content) {
      t.mark();
      t.emit({ type: "delta", content: chunk.message.content });
    }
    if (chunk.done) {
      t.finish({
        inputTokens: chunk.prompt_eval_count,
        outputTokens: chunk.eval_count,
        tokensPerSecond:
          chunk.eval_count && chunk.eval_duration
            ? chunk.eval_count / (chunk.eval_duration / 1e9)
            : undefined,
      });
    }
  }
}

async function runOpenAI(provider: ProviderConfig, name: string, req: ChatRequest, signal: AbortSignal, t: Tracker) {
  const body: Record<string, unknown> = {
    model: name,
    messages: withSystem(req),
    stream: true,
    stream_options: { include_usage: true },
  };
  if (req.temperature !== undefined) body.temperature = req.temperature;

  const res = await fetch(`${provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await errorText(res));

  let usage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
  for await (const chunk of readSse(res.body)) {
    if (chunk.error) throw new Error(JSON.stringify(chunk.error));
    const choices = chunk.choices as
      | { delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }[]
      | undefined;
    const delta = choices?.[0]?.delta;
    const reasoning = delta?.reasoning_content ?? delta?.reasoning;
    if (reasoning) {
      t.mark();
      t.emit({ type: "thinking", content: reasoning });
    }
    if (delta?.content) {
      t.mark();
      t.emit({ type: "delta", content: delta.content });
    }
    if (chunk.usage) usage = chunk.usage as typeof usage;
  }
  t.finish({ inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens });
}

async function runAnthropic(provider: ProviderConfig, name: string, req: ChatRequest, signal: AbortSignal, t: Tracker) {
  const thinking = req.think === "on";
  const body: Record<string, unknown> = {
    model: name,
    max_tokens: thinking ? 16000 : 8192,
    messages: req.messages.filter((m) => m.role !== "system"),
    stream: true,
  };
  if (req.system?.trim()) body.system = req.system.trim();
  if (thinking) body.thinking = { type: "enabled", budget_tokens: 8000 };
  else if (req.temperature !== undefined) body.temperature = Math.min(req.temperature, 1);

  const res = await fetch(`${provider.baseUrl}/messages`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": provider.apiKey!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw new Error(await errorText(res));

  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  for await (const event of readSse(res.body)) {
    switch (event.type) {
      case "message_start": {
        const message = event.message as { usage?: { input_tokens?: number } };
        inputTokens = message.usage?.input_tokens;
        break;
      }
      case "content_block_delta": {
        const delta = event.delta as { type: string; text?: string; thinking?: string };
        if (delta.type === "text_delta" && delta.text) {
          t.mark();
          t.emit({ type: "delta", content: delta.text });
        } else if (delta.type === "thinking_delta" && delta.thinking) {
          t.mark();
          t.emit({ type: "thinking", content: delta.thinking });
        }
        break;
      }
      case "message_delta": {
        const usage = event.usage as { output_tokens?: number } | undefined;
        outputTokens = usage?.output_tokens ?? outputTokens;
        break;
      }
      case "error": {
        const error = event.error as { message?: string } | undefined;
        throw new Error(error?.message ?? "Anthropic 返回错误");
      }
    }
  }
  t.finish({ inputTokens, outputTokens });
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

async function runDemo(req: ChatRequest, signal: AbortSignal, t: Tracker) {
  const last = [...req.messages].reverse().find((m) => m.role === "user")?.content ?? "";
  const preview = last.length > 60 ? `${last.slice(0, 60)}…` : last;
  const text = [
    `你刚才说的是：「${preview}」。`,
    "",
    "这是**演示模型**的固定回复，用来在没有真实模型时体验工作台的界面。要换成真实回答，有两种方式：",
    "",
    "1. **本地模型**：确认 Ollama 已启动，到「模型」页下载一个推荐模型，例如 `qwen3:8b`。",
    "2. **云端模型**：在项目根目录的 `.env.local` 里填写 API Key，例如 `DEEPSEEK_API_KEY`，然后重启开发服务。",
    "",
    "准备好之后，在左上角切换模型即可。",
  ].join("\n");

  await sleep(250, signal);
  const tokens = text.match(/[\s\S]{1,3}/g) ?? [];
  for (const token of tokens) {
    t.mark();
    t.emit({ type: "delta", content: token });
    await sleep(18, signal);
  }
  t.finish({ outputTokens: tokens.length });
}

export function chatStream(req: ChatRequest, requestSignal: AbortSignal) {
  const encoder = new TextEncoder();
  const local = new AbortController();
  const signal = AbortSignal.any([requestSignal, local.signal]);

  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send: Emit = (event) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {}
      };
      const tracker = createTracker(send);
      try {
        const parsed = splitModelId(req.model);
        const provider = parsed && getProvider(parsed.provider);
        if (!parsed || !provider) throw new Error(`未知模型：${req.model}`);
        if (!provider.configured) throw new Error(`${provider.label} 未配置，请在 .env.local 设置 ${provider.envHint}`);

        if (provider.kind === "ollama") await runOllama(parsed.name, req, signal, tracker);
        else if (provider.kind === "openai") await runOpenAI(provider, parsed.name, req, signal, tracker);
        else if (provider.kind === "anthropic") await runAnthropic(provider, parsed.name, req, signal, tracker);
        else await runDemo(req, signal, tracker);

        tracker.finish();
      } catch (error) {
        if (!signal.aborted) {
          send({ type: "error", message: error instanceof Error ? error.message : String(error) });
        }
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
    cancel() {
      local.abort();
    },
  });
}
