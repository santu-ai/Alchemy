import { isContextLength } from "@/lib/context";
import { chatStream } from "@/lib/server/chat";
import type { ChatMessage, ChatRequest } from "@/lib/types";

const ROLES = new Set(["user", "assistant", "system", "tool"]);

function invalid(message: string) {
  return Response.json({ error: message }, { status: 400 });
}

function checkMessage(message: ChatMessage) {
  if (!ROLES.has(message.role) || typeof message.content !== "string") return "消息格式不正确";
  if (message.content.length > 100_000) return "单条消息太长";
  if (message.images && message.images.length > 4) return "一次最多 4 张图片";
  if (message.images?.some((image) => typeof image !== "string" || image.length > 6_000_000)) return "图片太大";
  if (message.attachments && message.attachments.length > 4) return "一次最多 4 个附件";
  if (message.attachments?.some((file) => file.content.length > 100_000 || file.name.length > 200)) return "附件太大";
  return null;
}

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return invalid("请求格式不正确");
  }
  if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return invalid("缺少 model 或 messages");
  }
  if (body.messages.length > 80) return invalid("对话太长，请新开一轮");
  if (body.numCtx !== undefined && !isContextLength(body.numCtx)) return invalid("上下文长度不在可选范围内");
  for (const message of body.messages) {
    const problem = checkMessage(message);
    if (problem) return invalid(problem);
  }

  const purpose = body.purpose === "compare" ? "compare" : "chat";
  return new Response(chatStream(body, request.signal, { purpose }), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
