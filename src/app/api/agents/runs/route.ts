import { connection } from "next/server";

import type { AgentKind, RunMode } from "@/lib/agents/types";
import { noStore, runFailure } from "@/lib/server/agents/respond";
import { createRuns, listRuns } from "@/lib/server/agents/runs";

export async function GET() {
  await connection();
  try {
    return noStore({ runs: await listRuns() });
  } catch (error) {
    return runFailure(error);
  }
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    agents?: AgentKind[];
    mode?: RunMode;
    repo?: string;
    task?: string;
  };
  if (!Array.isArray(body.agents) || !body.mode || typeof body.repo !== "string" || typeof body.task !== "string") {
    return Response.json({ error: "缺少 agents、mode、repo 或 task" }, { status: 400 });
  }
  try {
    const runs = await createRuns({ agents: body.agents, mode: body.mode, repo: body.repo, task: body.task });
    return noStore({ runs });
  } catch (error) {
    return runFailure(error);
  }
}
