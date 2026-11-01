import { acquireLease } from "@/lib/server/inference";
import { ollamaError, ollamaFetch } from "@/lib/server/ollama";

export async function POST(request: Request) {
  const { model } = (await request.json().catch(() => ({}))) as { model?: string };
  const name = model?.trim();
  if (!name) return Response.json({ error: "请填写模型名称" }, { status: 400 });

  try {
    const res = await ollamaFetch("/api/pull", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: name, name, stream: true }),
      signal: request.signal,
    });
    if (!res.ok || !res.body) {
      return Response.json({ error: await ollamaError(res) }, { status: res.status || 502 });
    }
    const release = acquireLease(name, "pull");
    request.signal.addEventListener("abort", release, { once: true });
    const body = res.body.pipeThrough(new TransformStream({ flush: release }));
    return new Response(body, {
      headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 502 },
    );
  }
}
