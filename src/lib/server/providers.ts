import "server-only";

import type { ProviderInfo, ProviderKind } from "@/lib/types";

export interface ProviderConfig extends ProviderInfo {
  baseUrl: string;
  apiKey?: string;
  modelAllowlist?: string[];
}

interface ProviderSpec {
  id: string;
  label: string;
  kind: ProviderKind;
  keyEnv?: string;
  baseUrlEnv?: string;
  defaultBaseUrl?: string;
  modelsEnv?: string;
}

const CLOUD_SPECS: ProviderSpec[] = [
  {
    id: "openai",
    label: "OpenAI",
    kind: "openai",
    keyEnv: "OPENAI_API_KEY",
    baseUrlEnv: "OPENAI_BASE_URL",
    defaultBaseUrl: "https://api.openai.com/v1",
    modelsEnv: "OPENAI_MODELS",
  },
  {
    id: "anthropic",
    label: "Anthropic",
    kind: "anthropic",
    keyEnv: "ANTHROPIC_API_KEY",
    baseUrlEnv: "ANTHROPIC_BASE_URL",
    defaultBaseUrl: "https://api.anthropic.com/v1",
    modelsEnv: "ANTHROPIC_MODELS",
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    kind: "openai",
    keyEnv: "DEEPSEEK_API_KEY",
    baseUrlEnv: "DEEPSEEK_BASE_URL",
    defaultBaseUrl: "https://api.deepseek.com",
    modelsEnv: "DEEPSEEK_MODELS",
  },
  {
    id: "dashscope",
    label: "通义千问",
    kind: "openai",
    keyEnv: "DASHSCOPE_API_KEY",
    baseUrlEnv: "DASHSCOPE_BASE_URL",
    defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    modelsEnv: "DASHSCOPE_MODELS",
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    kind: "openai",
    keyEnv: "OPENROUTER_API_KEY",
    baseUrlEnv: "OPENROUTER_BASE_URL",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
    modelsEnv: "OPENROUTER_MODELS",
  },
  {
    id: "custom",
    label: "自定义接口",
    kind: "openai",
    keyEnv: "CUSTOM_OPENAI_API_KEY",
    baseUrlEnv: "CUSTOM_OPENAI_BASE_URL",
    modelsEnv: "CUSTOM_OPENAI_MODELS",
  },
];

function env(name?: string) {
  if (!name) return undefined;
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function list(name?: string) {
  const raw = env(name);
  if (!raw) return undefined;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : undefined;
}

export function ollamaHost() {
  const raw = env("OLLAMA_HOST") ?? "http://127.0.0.1:11434";
  const withScheme = /^https?:\/\//.test(raw) ? raw : `http://${raw}`;
  return withScheme.replace(/\/+$/, "").replace("0.0.0.0", "127.0.0.1");
}

export function getProviders(): ProviderConfig[] {
  const ollama: ProviderConfig = {
    id: "ollama",
    label: "Ollama 本地",
    kind: "ollama",
    local: true,
    configured: true,
    envHint: "OLLAMA_HOST",
    baseUrl: ollamaHost(),
  };

  const cloud = CLOUD_SPECS.map<ProviderConfig>((spec) => {
    const apiKey = env(spec.keyEnv);
    const baseUrl = (env(spec.baseUrlEnv) ?? spec.defaultBaseUrl ?? "").replace(/\/+$/, "");
    const label =
      spec.id === "custom" ? (env("CUSTOM_OPENAI_NAME") ?? spec.label) : spec.label;
    return {
      id: spec.id,
      label,
      kind: spec.kind,
      local: false,
      configured: Boolean(apiKey && baseUrl),
      envHint: spec.id === "custom" ? "CUSTOM_OPENAI_BASE_URL / CUSTOM_OPENAI_API_KEY" : spec.keyEnv!,
      baseUrl,
      apiKey,
      modelAllowlist: list(spec.modelsEnv),
    };
  });

  const demo: ProviderConfig = {
    id: "demo",
    label: "演示",
    kind: "demo",
    local: true,
    configured: true,
    envHint: "",
    baseUrl: "",
  };

  return [ollama, ...cloud, demo];
}

export function getProvider(id: string) {
  return getProviders().find((p) => p.id === id);
}

export function publicProvider({ id, label, kind, local, configured, envHint }: ProviderConfig): ProviderInfo {
  return { id, label, kind, local, configured, envHint };
}

export function splitModelId(id: string) {
  const index = id.indexOf("/");
  if (index <= 0) return null;
  return { provider: id.slice(0, index), name: id.slice(index + 1) };
}
