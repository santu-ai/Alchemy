import { startChecks } from "@/lib/server/agents/checks";
import { noStore, runFailure } from "@/lib/server/agents/respond";
import { publicRun, readMeta, RunError } from "@/lib/server/agents/store";
import { ensureWatcher } from "@/lib/server/agents/watcher";

const SETTLED = new Set(["done", "failed", "cancelled", "lost"]);

/** 手动跑（或重跑）当前轮的检查。点这个按钮就算确认了会执行 Agent 改过的配置。 */
export async function POST(_request: Request, ctx: RouteContext<"/api/agents/runs/[id]/checks">) {
  ensureWatcher();
  const { id } = await ctx.params;
  try {
    const meta = await readMeta(id);
    if (!SETTLED.has(meta.status)) throw new RunError("任务还没结束，或者已经合并、丢弃", 409);
    if (meta.checks?.round === meta.round && meta.checks.status === "running") {
      throw new RunError("检查正在跑", 409);
    }
    await startChecks(id, { approved: true });
    return noStore({ run: publicRun(await readMeta(id)) });
  } catch (error) {
    return runFailure(error);
  }
}
