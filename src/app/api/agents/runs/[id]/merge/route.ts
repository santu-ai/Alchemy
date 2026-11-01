import { noStore, runFailure } from "@/lib/server/agents/respond";
import { mergeRun, prepareMerge } from "@/lib/server/agents/runs";

/** 不带口令是预检，返回要合并的内容和一次性口令；带口令才真正合并。 */
export async function POST(request: Request, ctx: RouteContext<"/api/agents/runs/[id]/merge">) {
  const { id } = await ctx.params;
  const { nonce, message } = (await request.json().catch(() => ({}))) as { nonce?: string; message?: string };
  try {
    if (nonce === undefined) return noStore({ preview: await prepareMerge(id) });
    if (typeof nonce !== "string") return Response.json({ error: "确认口令不对" }, { status: 400 });
    return noStore({ run: await mergeRun(id, nonce, typeof message === "string" ? message : "") });
  } catch (error) {
    return runFailure(error);
  }
}
