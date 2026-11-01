import "server-only";

import type { ModelInfo, RunningModel } from "@/lib/types";
import { ollamaHost } from "./providers";

export class OllamaUnavailableError extends Error {}

export async function ollamaFetch(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs, ...rest } = init ?? {};
  const signal = rest.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);
  try {
    return await fetch(`${ollamaHost()}${path}`, { ...rest, signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new OllamaUnavailableError(
      `无法连接 Ollama（${ollamaHost()}）。请确认 Ollama 应用已启动。`,
    );
  }
}

export async function ollamaError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: string };
    if (data.error) return data.error;
  } catch {}
  return text || `Ollama 返回 ${res.status}`;
}

interface OllamaTag {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export async function listOllamaModels(): Promise<ModelInfo[]> {
  const res = await ollamaFetch("/api/tags", { timeoutMs: 4000 });
  if (!res.ok) throw new Error(await ollamaError(res));
  const data = (await res.json()) as { models?: OllamaTag[] };
  return (data.models ?? [])
    .map((m) => ({
      id: `ollama/${m.name}`,
      provider: "ollama",
      providerLabel: "Ollama 本地",
      name: m.name,
      local: true,
      sizeBytes: m.size,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      family: m.details?.family,
      modifiedAt: m.modified_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listRunningModels(): Promise<RunningModel[]> {
  const res = await ollamaFetch("/api/ps", { timeoutMs: 4000 });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    models?: {
      name: string;
      size?: number;
      size_vram?: number;
      expires_at?: string;
      context_length?: number;
    }[];
  };
  return (data.models ?? []).map((m) => {
    const size = m.size ?? 0;
    const vram = m.size_vram ?? 0;
    return {
      name: m.name,
      sizeBytes: size,
      vramBytes: vram,
      expiresAt: m.expires_at,
      contextLength: m.context_length,
      gpuPercent: size > 0 ? Math.round((vram / size) * 100) : undefined,
    };
  });
}

export interface OllamaModelFacts {
  contextLength?: number;
  capabilities: string[];
  thinkingValues: Array<string | boolean>;
  thinkingDefault?: string | boolean;
}

const showCache = new Map<string, { at: number; facts: OllamaModelFacts }>();
const SHOW_TTL_MS = 5 * 60 * 1000;

function contextFromInfo(info?: Record<string, unknown>) {
  if (!info) return undefined;
  for (const [key, value] of Object.entries(info)) {
    if (key.endsWith(".context_length") && typeof value === "number") return value;
  }
  return undefined;
}

export async function showOllamaModel(name: string): Promise<OllamaModelFacts> {
  const hit = showCache.get(name);
  if (hit && Date.now() - hit.at < SHOW_TTL_MS) return hit.facts;

  const res = await ollamaFetch("/api/show", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: name }),
    timeoutMs: 8000,
  });
  if (!res.ok) throw new Error(await ollamaError(res));
  const data = (await res.json()) as {
    capabilities?: string[];
    model_info?: Record<string, unknown>;
    thinking?: { values?: Array<string | boolean>; default?: string | boolean };
  };
  const facts: OllamaModelFacts = {
    contextLength: contextFromInfo(data.model_info),
    capabilities: data.capabilities ?? [],
    thinkingValues: data.thinking?.values ?? [],
    thinkingDefault: data.thinking?.default,
  };
  showCache.set(name, { at: Date.now(), facts });
  return facts;
}

async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await fn(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function enrichOllamaModels(models: ModelInfo[]): Promise<ModelInfo[]> {
  return mapPool(models, 4, async (model) => {
    try {
      const facts = await showOllamaModel(model.name);
      return { ...model, ...facts };
    } catch {
      return model;
    }
  });
}

export async function ollamaVersion() {
  const res = await ollamaFetch("/api/version", { timeoutMs: 3000 });
  if (!res.ok) throw new Error(await ollamaError(res));
  const data = (await res.json()) as { version?: string };
  return data.version ?? "未知";
}
