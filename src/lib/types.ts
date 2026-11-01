export type ProviderKind = "ollama" | "openai" | "anthropic" | "demo";

export interface ProviderInfo {
  id: string;
  label: string;
  kind: ProviderKind;
  local: boolean;
  configured: boolean;
  envHint: string;
}

export interface ModelInfo {
  id: string;
  provider: string;
  providerLabel: string;
  name: string;
  local: boolean;
  sizeBytes?: number;
  parameterSize?: string;
  quantization?: string;
  family?: string;
  modifiedAt?: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  providers: ProviderInfo[];
  errors: { provider: string; message: string }[];
}

export interface RunningModel {
  name: string;
  sizeBytes: number;
  vramBytes: number;
  expiresAt?: string;
}

export interface StatusResponse {
  ollama: {
    host: string;
    reachable: boolean;
    version?: string;
    error?: string;
    running: RunningModel[];
  };
  providers: ProviderInfo[];
}

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export type ThinkMode = "default" | "on" | "off";

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  think?: ThinkMode;
}

export interface GenerationStats {
  ttftMs?: number;
  totalMs: number;
  inputTokens?: number;
  outputTokens?: number;
  tokensPerSecond?: number;
}

export type StreamEvent =
  | { type: "delta"; content: string }
  | { type: "thinking"; content: string }
  | { type: "done"; stats: GenerationStats }
  | { type: "error"; message: string };
