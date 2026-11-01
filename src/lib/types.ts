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
  /** 模型自己声明的最大上下文，不是这次实际加载的长度。 */
  contextLength?: number;
  capabilities?: string[];
  thinkingValues?: Array<string | boolean>;
  thinkingDefault?: string | boolean;
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
  /** 这次加载实际分配的上下文。 */
  contextLength?: number;
  /** 权重放在 GPU 上的比例，0–100。 */
  gpuPercent?: number;
}

export interface ChatAttachment {
  name: string;
  content: string;
}

export type InferencePurpose = "chat" | "compare" | "review" | "pull";

export const PURPOSE_LABELS: Record<InferencePurpose, string> = {
  chat: "对话",
  compare: "模型对比",
  review: "Agent 审查",
  pull: "下载",
};

/** 炼丹炉自己发起、还没结束的本机 Ollama 请求。 */
export interface InferenceLease {
  id: string;
  model: string;
  purpose: InferencePurpose;
  label?: string;
  startedAt: number;
}

export interface NodeSummary {
  agents: Array<{ kind: string; label: string; available: boolean; version?: string; loggedIn?: boolean }>;
  /** 只列装了的。 */
  ides: Array<{ id: string; label: string }>;
  runs: {
    running: number;
    /** 跑完了、工作树还在，等你合并或丢弃。 */
    waiting: number;
    checksFailed: number;
  };
  home: { path: string; bytes?: number };
  service: {
    pid: number;
    startedAt: number;
    /** 由 launchd 托管，开机自启、崩溃自动拉起。 */
    managed: boolean;
    production: boolean;
  };
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
  nodes: NodeSummary;
  inference: InferenceLease[];
  /** 需要你留意的资源情况，只提示不拦截。 */
  warnings: string[];
  /** 服务端生成这份状态的时间，页面上的「已运行多久」以它为准。 */
  checkedAt: number;
}

export interface ChatMessage {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  /** data URL 或纯 base64。只出现在用户消息上。 */
  images?: string[];
  attachments?: ChatAttachment[];
}

/** `default` 不传；`on` / `off` 是布尔；其余字符串是模型自己的思考档，例如 low。 */
export type ThinkMode = "default" | "on" | "off" | "low" | "medium" | "high" | "max" | (string & {});

export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  system?: string;
  temperature?: number;
  think?: ThinkMode;
  /** 只对 Ollama 生效。 */
  numCtx?: number;
  /** 只对 Ollama 生效，启用本机的时间和附件工具。 */
  tools?: boolean;
  /** 只用来在概览里标出是谁在占用本机模型。 */
  purpose?: "chat" | "compare";
}

export interface ToolTrace {
  name: string;
  arguments?: unknown;
  result: string;
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
  | { type: "tool"; trace: ToolTrace }
  | { type: "done"; stats: GenerationStats }
  | { type: "error"; message: string };
