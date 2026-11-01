import { connection } from "next/server";

import { listRunningModels, ollamaVersion } from "@/lib/server/ollama";
import { getProviders, ollamaHost, publicProvider } from "@/lib/server/providers";
import type { StatusResponse } from "@/lib/types";

export async function GET() {
  await connection();
  const ollama: StatusResponse["ollama"] = { host: ollamaHost(), reachable: false, running: [] };
  try {
    ollama.version = await ollamaVersion();
    ollama.reachable = true;
    ollama.running = await listRunningModels();
  } catch (error) {
    ollama.error = error instanceof Error ? error.message : String(error);
  }

  const body: StatusResponse = { ollama, providers: getProviders().map(publicProvider) };
  return Response.json(body, { headers: { "Cache-Control": "no-store" } });
}
