import { spawn } from "node:child_process";

import { ideCommand, isIdeId } from "@/lib/server/agents/env";
import { noStore, runFailure } from "@/lib/server/agents/respond";
import { runFilePath } from "@/lib/server/agents/runs";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as {
    runId?: string;
    ide?: string;
    file?: string;
    line?: number;
    /** 另一个任务的编号：两边打开同一个文件做对比。 */
    against?: string;
  };
  if (typeof body.runId !== "string" || !isIdeId(body.ide)) {
    return Response.json({ error: "缺少 runId 或 IDE" }, { status: 400 });
  }
  const file = typeof body.file === "string" ? body.file : undefined;
  if (typeof body.against === "string" && !file) {
    return Response.json({ error: "对比需要指定文件" }, { status: 400 });
  }

  try {
    const target = await runFilePath(body.runId, file);
    const line = Number.isInteger(body.line) && body.line! > 0 ? body.line! : undefined;
    let args = file && line ? ["--line", String(line), target] : [target];
    if (typeof body.against === "string") args = ["diff", target, await runFilePath(body.against, file)];

    const command = await ideCommand(body.ide, args);
    if (!command) return Response.json({ error: "没有找到这个 IDE 的启动脚本" }, { status: 404 });
    const child = spawn(command.file, command.args, { detached: true, stdio: "ignore" });
    child.unref();
    return noStore({ ok: true });
  } catch (error) {
    return runFailure(error);
  }
}
