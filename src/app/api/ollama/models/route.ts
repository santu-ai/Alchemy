import { ollamaError, ollamaFetch } from "@/lib/server/ollama";

async function readModel(request: Request) {
  const { model } = (await request.json().catch(() => ({}))) as { model?: string };
  return model?.trim();
}

function failure(error: unknown) {
  return Response.json(
    { error: error instanceof Error ? error.message : String(error) },
    { status: 502 },
  );
}

export async function DELETE(request: Request) {
  const model = await readModel(request);
  if (!model) return Response.json({ error: "缺少模型名称" }, { status: 400 });
  try {
    const res = await ollamaFetch("/api/delete", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, name: model }),
      timeoutMs: 15000,
    });
    if (!res.ok) return Response.json({ error: await ollamaError(res) }, { status: res.status });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(request: Request) {
  const model = await readModel(request);
  if (!model) return Response.json({ error: "缺少模型名称" }, { status: 400 });
  try {
    const res = await ollamaFetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, keep_alive: 0 }),
      timeoutMs: 15000,
    });
    if (!res.ok) return Response.json({ error: await ollamaError(res) }, { status: res.status });
    return Response.json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
