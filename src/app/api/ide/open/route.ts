import { spawn } from "node:child_process";

import { ideLauncher, isIdeId } from "@/lib/server/agents/env";
import { noStore, runFailure } from "@/lib/server/agents/respond";
import { runFilePath } from "@/lib/server/agents/runs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runId?: string;
    ide?: string;
    file?: string;
    line?: number;
  };
  if (typeof body.runId !== "string" || !isIdeId(body.ide)) {
    return Response.json({ error: "缺少 runId 或 IDE" }, { status: 400 });
  }
  const launcher = ideLauncher(body.ide);
  if (!launcher) return Response.json({ error: "没有找到这个 IDE 的启动脚本" }, { status: 404 });

  try {
    const target = await runFilePath(body.runId, typeof body.file === "string" ? body.file : undefined);
    const line = Number.isInteger(body.line) && body.line! > 0 ? body.line! : undefined;
    const args = body.file && line ? ["--line", String(line), target] : [target];
    const child = spawn(launcher, args, { detached: true, stdio: "ignore" });
    child.unref();
    return noStore({ ok: true });
  } catch (error) {
    return runFailure(error);
  }
}
