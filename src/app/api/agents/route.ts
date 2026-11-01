import { connection } from "next/server";

import type { AgentsResponse } from "@/lib/agents/types";
import { ALCHEMY_HOME, probeAgents, probeIdes } from "@/lib/server/agents/env";
import { listRepos } from "@/lib/server/agents/git";
import { noStore } from "@/lib/server/agents/respond";

export async function GET() {
  await connection();
  const [agents, repos] = await Promise.all([probeAgents(), listRepos()]);
  const body: AgentsResponse = { agents, repos, ides: probeIdes(), home: ALCHEMY_HOME };
  return noStore(body);
}
