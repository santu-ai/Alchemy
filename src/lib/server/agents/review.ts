import "server-only";

import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

import type { RunReview } from "@/lib/agents/types";
import type { StreamEvent } from "@/lib/types";
import { chatStream } from "../chat";
import { diffChanges, git } from "./git";
import { readMeta, RunError, runFile, type RunMeta } from "./store";

const MAX_DIFF_CHARS = 80_000;
const REVIEWABLE = new Set(["done", "failed", "cancelled", "lost"]);

const SYSTEM = `你是严格、务实的代码审查者。你会拿到一个编码 Agent 收到的任务，以及它在独立工作树里做出的完整 diff。
用简体中文回答，按下面的结构输出 Markdown：

## 结论
从「可以合并」「建议修改后合并」「不建议合并」三个里选且只选一个，原样写出来，后面跟一句理由。

## 是否超出任务范围
列出和任务无关的改动；没有就写「没有」。

## 问题
每条写明文件和大致行号、问题、为什么是问题。按严重程度排序，只写真问题，不凑数；没有就写「没发现明显问题」。

## 建议
最多三条，具体到怎么改。`;

/** 审查只走本机 Ollama，diff 不出这台电脑；Ollama 的 cloud 模型也会上传，同样拒绝。 */
function assertLocalModel(model: string) {
  if (!/^ollama\/\S+$/.test(model) || /[-:]cloud$/i.test(model)) {
    throw new RunError("审查只能用本机 Ollama 模型", 400);
  }
}

async function buildPrompt(meta: RunMeta) {
  const files = await diffChanges(meta.worktree!, meta.baseCommit!);
  if (files.length === 0) throw new RunError("没有改动可以审查", 409);
  let diff = await git(
    meta.worktree!,
    ["diff", meta.baseCommit!, "-U3", "--no-color", "--no-renames", "--no-ext-diff"],
    60_000,
  );
  const truncated = diff.length > MAX_DIFF_CHARS;
  if (truncated) diff = diff.slice(0, MAX_DIFF_CHARS);

  const rounds = meta.rounds
    .map((round, index) => (index === 0 ? `任务：\n${round.message}` : `第 ${index + 1} 轮追加要求：\n${round.message}`))
    .join("\n\n");
  const checks = meta.checks?.round === meta.round ? meta.checks : undefined;
  const checkLine = checks?.items.length
    ? `自动检查：${checks.items.map((item) => `${item.name} ${item.exitCode === 0 ? "通过" : item.exitCode === undefined ? "未运行" : "失败"}`).join("，")}`
    : "";
  const fileList = files.map((file) => `- ${file.path}（+${file.added ?? "?"} −${file.removed ?? "?"}）`).join("\n");

  return {
    content: [
      rounds,
      checkLine,
      `改动文件：\n${fileList}`,
      `diff${truncated ? `（太长，只给出前 ${MAX_DIFF_CHARS} 个字符）` : ""}：\n\`\`\`diff\n${diff}\n\`\`\``,
    ]
      .filter(Boolean)
      .join("\n\n"),
    numCtx: Math.min(32_768, Math.max(8_192, Math.ceil(diff.length / 3 / 1024) * 1024 + 4_096)),
  };
}

export async function reviewStream(id: string, model: string, signal: AbortSignal) {
  assertLocalModel(model);
  const meta = await readMeta(id);
  if (!REVIEWABLE.has(meta.status)) throw new RunError("任务还没结束，或者已经合并、丢弃", 409);
  if (!meta.worktree || !meta.baseCommit || !existsSync(meta.worktree)) throw new RunError("工作树已经不在了", 404);
  const prompt = await buildPrompt(meta);
  const round = meta.round;

  let text = "";
  let failed = false;
  let pending = "";
  const decoder = new TextDecoder();
  const collect = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as StreamEvent;
    if (event.type === "delta") text += event.content;
    else if (event.type === "error") failed = true;
  };

  return chatStream(
    { model, system: SYSTEM, messages: [{ role: "user", content: prompt.content }], numCtx: prompt.numCtx },
    signal,
    { purpose: "review", label: meta.rounds[0]?.message.split("\n")[0].slice(0, 40) },
  ).pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(chunk);
        pending += decoder.decode(chunk, { stream: true });
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        lines.forEach(collect);
      },
      async flush() {
        collect(pending);
        if (failed || signal.aborted || !text.trim()) return;
        const review: RunReview = { round, model, text: text.trim(), at: Date.now() };
        await writeFile(runFile(id, "review.json"), JSON.stringify(review, null, 2));
      },
    }),
  );
}

export async function readReview(meta: RunMeta): Promise<RunReview | undefined> {
  try {
    const review = JSON.parse(await readFile(runFile(meta.id, "review.json"), "utf8")) as RunReview;
    return review.round === meta.round ? review : undefined;
  } catch {
    return undefined;
  }
}
