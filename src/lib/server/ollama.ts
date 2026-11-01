import "server-only";

import type { ModelInfo, RunningModel } from "@/lib/types";
import { ollamaHost } from "./providers";

export class OllamaUnavailableError extends Error {}

export async function ollamaFetch(path: string, init?: RequestInit & { timeoutMs?: number }) {
  const { timeoutMs, ...rest } = init ?? {};
  const signal = rest.signal ?? (timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined);
  try {
    return await fetch(`${ollamaHost()}${path}`, { ...rest, signal, cache: "no-store" });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new OllamaUnavailableError(
      `无法连接 Ollama（${ollamaHost()}）。请确认 Ollama 应用已启动。`,
    );
  }
}

export async function ollamaError(res: Response) {
  const text = await res.text().catch(() => "");
  try {
    const data = JSON.parse(text) as { error?: string };
    if (data.error) return data.error;
  } catch {}
  return text || `Ollama 返回 ${res.status}`;
}

interface OllamaTag {
  name: string;
  model?: string;
  modified_at?: string;
  size?: number;
  details?: { family?: string; parameter_size?: string; quantization_level?: string };
}

export async function listOllamaModels(): Promise<ModelInfo[]> {
  const res = await ollamaFetch("/api/tags", { timeoutMs: 4000 });
  if (!res.ok) throw new Error(await ollamaError(res));
  const data = (await res.json()) as { models?: OllamaTag[] };
  return (data.models ?? [])
    .map((m) => ({
      id: `ollama/${m.name}`,
      provider: "ollama",
      providerLabel: "Ollama 本地",
      name: m.name,
      local: true,
      sizeBytes: m.size,
      parameterSize: m.details?.parameter_size,
      quantization: m.details?.quantization_level,
      family: m.details?.family,
      modifiedAt: m.modified_at,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function listRunningModels(): Promise<RunningModel[]> {
  const res = await ollamaFetch("/api/ps", { timeoutMs: 4000 });
  if (!res.ok) return [];
  const data = (await res.json()) as {
    models?: { name: string; size?: number; size_vram?: number; expires_at?: string }[];
  };
  return (data.models ?? []).map((m) => ({
    name: m.name,
    sizeBytes: m.size ?? 0,
    vramBytes: m.size_vram ?? 0,
    expiresAt: m.expires_at,
  }));
}

export async function ollamaVersion() {
  const res = await ollamaFetch("/api/version", { timeoutMs: 3000 });
  if (!res.ok) throw new Error(await ollamaError(res));
  const data = (await res.json()) as { version?: string };
  return data.version ?? "未知";
}
