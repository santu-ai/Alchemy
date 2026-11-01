import "server-only";

import type { ModelInfo } from "@/lib/types";
import type { ProviderConfig } from "./providers";

const NON_CHAT =
  /(embed|embedding|tts|whisper|dall-e|davinci|babbage|moderation|image|audio|realtime|transcribe|speech|rerank|search-preview|computer-use|sora)/i;

const cache = new Map<string, { at: number; models: ModelInfo[] }>();
const TTL_MS = 5 * 60 * 1000;

function toModel(provider: ProviderConfig, name: string): ModelInfo {
  return {
    id: `${provider.id}/${name}`,
    provider: provider.id,
    providerLabel: provider.label,
    name,
    local: false,
  };
}

async function fetchRemoteIds(provider: ProviderConfig): Promise<string[]> {
  const headers: Record<string, string> =
    provider.kind === "anthropic"
      ? { "x-api-key": provider.apiKey!, "anthropic-version": "2023-06-01" }
      : { Authorization: `Bearer ${provider.apiKey}` };
  const url =
    provider.kind === "anthropic" ? `${provider.baseUrl}/models?limit=100` : `${provider.baseUrl}/models`;
  const res = await fetch(url, { headers, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`获取模型列表失败（${res.status}）${body ? `：${body.slice(0, 160)}` : ""}`);
  }
  const data = (await res.json()) as { data?: { id: string }[] };
  return (data.data ?? []).map((m) => m.id).filter((id) => !NON_CHAT.test(id));
}

export async function listCloudModels(provider: ProviderConfig): Promise<ModelInfo[]> {
  if (provider.modelAllowlist) return provider.modelAllowlist.map((name) => toModel(provider, name));

  const key = `${provider.id}:${provider.baseUrl}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.models;

  const ids = await fetchRemoteIds(provider);
  const models = ids.sort((a, b) => a.localeCompare(b)).map((name) => toModel(provider, name));
  cache.set(key, { at: Date.now(), models });
  return models;
}
