import { noStore, runFailure } from "@/lib/server/agents/respond";
import { cancelRun } from "@/lib/server/agents/runs";

export async function POST(_request: Request, ctx: RouteContext<"/api/agents/runs/[id]/cancel">) {
  const { id } = await ctx.params;
  try {
    return noStore({ run: await cancelRun(id) });
  } catch (error) {
    return runFailure(error);
  }
}
