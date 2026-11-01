import { connection } from "next/server";

import { ensureWatcher } from "@/lib/server/agents/watcher";
import { activeLeases, inferenceWarnings } from "@/lib/server/inference";
import { nodeSummary } from "@/lib/server/nodes";
import { listRunningModels, ollamaVersion } from "@/lib/server/ollama";
import { getProviders, ollamaHost, publicProvider } from "@/lib/server/providers";
import type { StatusResponse } from "@/lib/types";

export async function GET() {
  await connection();
  // 每个页面都在轮询 status，挂在这里，Agent 的检查和通知就不依赖你开着 Agent 页。
  ensureWatcher();
  const ollama: StatusResponse["ollama"] = { host: ollamaHost(), reachable: false, running: [] };
  const nodes = nodeSummary();
  try {
    ollama.version = await ollamaVersion();
    ollama.reachable = true;
    ollama.running = await listRunningModels();
  } catch (error) {
    ollama.error = error instanceof Error ? error.message : String(error);
  }

  const inference = activeLeases();
  const body: StatusResponse = {
    ollama,
    providers: getProviders().map(publicProvider),
    nodes: await nodes,
    inference,
    warnings: inferenceWarnings(ollama.running, inference),
    checkedAt: Date.now(),
  };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
