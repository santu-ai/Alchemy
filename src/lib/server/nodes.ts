import "server-only";

import type { NodeSummary } from "@/lib/types";
import { ALCHEMY_HOME, execFileAsync, peekAgents, probeIdes } from "./agents/env";
import { runsSummary } from "./agents/runs";

const usage: { bytes?: number; at: number; busy: boolean } = { at: 0, busy: false };

/** 工作树可能很大，du 放后台、五分钟算一次。 */
function homeBytes() {
  if (!usage.busy && Date.now() - usage.at > 5 * 60_000) {
    usage.busy = true;
    execFileAsync("du", ["-sk", ALCHEMY_HOME], { timeout: 60_000 })
      .then(({ stdout }) => {
        const kb = Number(stdout.trim().split(/\s+/)[0]);
        usage.bytes = Number.isFinite(kb) ? kb * 1024 : undefined;
      })
      .catch(() => {})
      .finally(() => {
        usage.at = Date.now();
        usage.busy = false;
      });
  }
  return usage.bytes;
}

export async function nodeSummary(): Promise<NodeSummary> {
  return {
    agents: peekAgents(),
    ides: probeIdes()
      .filter((ide) => ide.available)
      .map(({ id, label }) => ({ id, label })),
    runs: await runsSummary().catch(() => ({ running: 0, waiting: 0, checksFailed: 0 })),
    home: { path: ALCHEMY_HOME, bytes: homeBytes() },
    service: {
      pid: process.pid,
      startedAt: Math.round(Date.now() - process.uptime() * 1000),
      managed: process.env.ALCHEMY_SERVICE === "launchd",
      production: process.env.NODE_ENV === "production",
    },
  };
}
