import { chatStream } from "@/lib/server/chat";
import type { ChatRequest } from "@/lib/types";

export async function POST(request: Request) {
  let body: ChatRequest;
  try {
    body = (await request.json()) as ChatRequest;
  } catch {
    return Response.json({ error: "请求格式不正确" }, { status: 400 });
  }
  if (!body.model || !Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ error: "缺少 model 或 messages" }, { status: 400 });
  }

  return new Response(chatStream(body, request.signal), {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
