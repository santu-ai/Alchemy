import { noStore, runFailure } from "@/lib/server/agents/respond";
import { continueRun } from "@/lib/server/agents/runs";
import { ensureWatcher } from "@/lib/server/agents/watcher";

/** 在同一个工作树和会话上追加一轮。 */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/runs/[id]/continue">) {
  ensureWatcher();
  const { id } = await ctx.params;
  const { message } = (await request.json().catch(() => ({}))) as { message?: string };
  if (typeof message !== "string") return Response.json({ error: "缺少 message" }, { status: 400 });
  try {
    return noStore({ run: await continueRun(id, message) });
  } catch (error) {
    return runFailure(error);
  }
}
