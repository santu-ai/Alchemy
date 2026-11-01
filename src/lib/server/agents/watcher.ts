import "server-only";

import { AGENT_LABELS, STATUS_LABELS, type RunChecks } from "@/lib/agents/types";
import { startChecks, syncChecks } from "./checks";
import { notify } from "./notify";
import { listMetas } from "./runs";
import { updateMeta, type RunMeta } from "./store";

const INTERVAL_MS = 3_000;
/** 服务重启后，不给早就结束的老任务补发通知。 */
const NOTIFY_WINDOW_MS = 15 * 60_000;
const SETTLED = new Set(["done", "failed", "cancelled", "lost"]);

function checksSummary(checks: RunChecks | undefined) {
  if (!checks || checks.status === "none") return "";
  if (checks.status === "passed") return "检查通过";
  if (checks.status === "blocked") return "改了配置，检查等你确认";
  const failed = checks.items.filter((item) => item.exitCode !== 0).map((item) => item.name);
  return `检查没通过：${failed.join("、")}`;
}

async function announce(meta: RunMeta) {
  const endedAt = meta.rounds.at(-1)?.endedAt ?? meta.endedAt ?? 0;
  if (meta.status !== "cancelled" && Date.now() - endedAt < NOTIFY_WINDOW_MS) {
    const task = meta.rounds.at(-1)?.message.split("\n")[0] ?? "";
    const parts = [STATUS_LABELS[meta.status], checksSummary(meta.checks)].filter(Boolean).join(" · ");
    await notify(`炼丹炉 · ${AGENT_LABELS[meta.agent]}`, `${parts}\n${task.length > 60 ? `${task.slice(0, 59)}…` : task}`);
  }
  await updateMeta(meta.id, (m) => (m.notifiedRound = meta.round));
}

async function settle(meta: RunMeta) {
  if (!SETTLED.has(meta.status)) return;
  const current = meta.checks?.round === meta.round ? meta.checks : undefined;
  if (!current && meta.status !== "cancelled") {
    await startChecks(meta.id);
    return;
  }
  if (current?.status === "running") {
    const next = await syncChecks(meta.id);
    if (next.checks?.status === "running") return;
    meta = next;
  }
  if (meta.notifiedRound !== meta.round) await announce(meta);
}

async function tick() {
  for (const meta of await listMetas()) {
    try {
      await settle(meta);
    } catch (error) {
      console.error(`[alchemy] 处理任务 ${meta.id} 失败`, error);
    }
  }
}

interface Watcher {
  timer: NodeJS.Timeout;
  busy: boolean;
  tick: () => Promise<void>;
}

const globalWatcher = globalThis as typeof globalThis & { __alchemyRunWatcher?: Watcher };

/** 任务进程脱离了 Next，只能轮询。挂在 globalThis 上，热更新不会多开，只换掉 tick。 */
export function ensureWatcher() {
  const existing = globalWatcher.__alchemyRunWatcher;
  if (existing) {
    existing.tick = tick;
    return;
  }
  const watcher: Watcher = {
    busy: false,
    tick,
    timer: setInterval(async () => {
      if (watcher.busy) return;
      watcher.busy = true;
      try {
        await watcher.tick();
      } catch (error) {
        console.error("[alchemy] 任务巡检失败", error);
      } finally {
        watcher.busy = false;
      }
    }, INTERVAL_MS),
  };
  watcher.timer.unref();
  globalWatcher.__alchemyRunWatcher = watcher;
}
