import "server-only";

import type { ChatAttachment, ChatRequest } from "@/lib/types";

export const LAB_TOOLS = [
  {
    type: "function",
    function: {
      name: "current_time",
      description: "获取这台电脑当前的本地时间和时区。用户问现在几点或今天日期时使用。",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "read_attachment",
      description: "读取用户这次发来的文本附件。不能访问电脑上的其他文件。不传 name 时列出全部附件。",
      parameters: {
        type: "object",
        properties: {
          name: { type: "string", description: "附件文件名" },
        },
      },
    },
  },
] as const;

export interface ToolCall {
  function?: { name?: string; arguments?: unknown };
}

export function callName(call: ToolCall) {
  return call.function?.name?.trim() || "未知工具";
}

export function callArguments(call: ToolCall): unknown {
  const raw = call.function?.arguments;
  if (typeof raw !== "string") return raw ?? {};
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

function attachmentsOf(req: ChatRequest): ChatAttachment[] {
  return req.messages.flatMap((message) => message.attachments ?? []);
}

function readAttachment(args: unknown, files: ChatAttachment[]) {
  const name = typeof args === "object" && args && "name" in args ? String((args as { name?: unknown }).name ?? "") : "";
  if (!files.length) return "这次没有文本附件。";
  if (!name.trim()) {
    return files.map((file) => `【${file.name}】\n${file.content.slice(0, 8000)}`).join("\n\n");
  }
  const file = files.find((item) => item.name.toLowerCase() === name.trim().toLowerCase());
  if (!file) return `没有名为「${name}」的附件。当前有：${files.map((item) => item.name).join("、")}`;
  const body = file.content.slice(0, 8000);
  return body.length < file.content.length ? `${body}\n\n（已截断，原文更长）` : body;
}

export function runLabTool(call: ToolCall, req: ChatRequest) {
  const name = callName(call);
  const args = callArguments(call);
  if (name === "current_time") {
    const now = new Date();
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return `${now.toLocaleString("zh-CN", { hour12: false })}（${zone}）`;
  }
  if (name === "read_attachment") return readAttachment(args, attachmentsOf(req));
  return `没有名为 ${name} 的本地工具。可用工具：current_time、read_attachment。`;
}
