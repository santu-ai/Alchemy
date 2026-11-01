import { runFailure } from "@/lib/server/agents/respond";
import { reviewStream } from "@/lib/server/agents/review";

/** 用本机 Ollama 审查当前轮的 diff，流式返回，结束后存档。 */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/runs/[id]/review">) {
  const { id } = await ctx.params;
  const { model } = (await request.json().catch(() => ({}))) as { model?: string };
  if (typeof model !== "string") return Response.json({ error: "缺少 model" }, { status: 400 });
  try {
    const stream = await reviewStream(id, model, request.signal);
    return new Response(stream, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return runFailure(error);
  }
}
