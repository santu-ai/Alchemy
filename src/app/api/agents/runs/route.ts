import { connection } from "next/server";

import type { AgentKind, RunMode } from "@/lib/agents/types";
import { noStore, runFailure } from "@/lib/server/agents/respond";
import { createRun, listRuns } from "@/lib/server/agents/runs";

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
    agent?: AgentKind;
    mode?: RunMode;
    repo?: string;
    task?: string;
  };
  if (!body.agent || !body.mode || typeof body.repo !== "string" || typeof body.task !== "string") {
    return Response.json({ error: "缺少 agent、mode、repo 或 task" }, { status: 400 });
  }
  try {
    return noStore(await createRun({ agent: body.agent, mode: body.mode, repo: body.repo, task: body.task }));
  } catch (error) {
    return runFailure(error);
  }
}
