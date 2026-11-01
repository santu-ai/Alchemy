import type { ChatRequest, StreamEvent } from "@/lib/types";

export async function* readNdjson<T>(res: Response): AsyncGenerator<T> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let index: number;
    while ((index = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line) yield JSON.parse(line) as T;
    }
  }
  const rest = buffer.trim();
  if (rest) yield JSON.parse(rest) as T;
}

async function responseError(res: Response) {
  const data = (await res.json().catch(() => null)) as { error?: string } | null;
  return data?.error ?? `请求失败（${res.status}）`;
}

export async function streamChat(
  request: ChatRequest,
  onEvent: (event: StreamEvent) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!res.ok) {
    onEvent({ type: "error", message: await responseError(res) });
    return;
  }
  for await (const event of readNdjson<StreamEvent>(res)) onEvent(event);
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  error?: string;
}

export async function pullModel(
  model: string,
  onProgress: (progress: PullProgress) => void,
  signal?: AbortSignal,
) {
  const res = await fetch("/api/ollama/pull", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
    signal,
  });
  if (!res.ok) throw new Error(await responseError(res));
  for await (const progress of readNdjson<PullProgress>(res)) {
    if (progress.error) throw new Error(progress.error);
    onProgress(progress);
  }
}

export async function ollamaModelAction(method: "DELETE" | "PATCH", model: string) {
  const res = await fetch("/api/ollama/models", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  });
  if (!res.ok) throw new Error(await responseError(res));
}
