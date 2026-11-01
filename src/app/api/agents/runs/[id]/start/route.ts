import { noStore, runFailure } from "@/lib/server/agents/respond";
import { startRun } from "@/lib/server/agents/runs";

export async function POST(request: Request, ctx: RouteContext<"/api/agents/runs/[id]/start">) {
  const { id } = await ctx.params;
  const { nonce } = (await request.json().catch(() => ({}))) as { nonce?: string };
  if (typeof nonce !== "string") return Response.json({ error: "缺少确认口令" }, { status: 400 });
  try {
    return noStore({ run: await startRun(id, nonce) });
  } catch (error) {
    return runFailure(error);
  }
}
