export type LogEventKind = "text" | "tool" | "result" | "error" | "info";

export interface LogEvent {
  kind: LogEventKind;
  text: string;
}

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function contentText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => (isObject(part) && typeof part.text === "string" ? part.text : ""))
    .join("");
}

/** 深度优先找第一个像正文的字符串字段，给格式未知的事件兜底。 */
function firstText(value: unknown, depth = 0): string | undefined {
  if (depth > 4 || !isObject(value)) return undefined;
  for (const key of ["text", "content", "message", "result", "summary", "description", "command", "path"]) {
    const field = value[key];
    if (typeof field === "string" && field.trim()) return field;
    const nested = key === "content" ? contentText(field) : "";
    if (nested.trim()) return nested;
  }
  for (const field of Object.values(value)) {
    const found = firstText(field, depth + 1);
    if (found) return found;
  }
  return undefined;
}

function toolSummary(event: Json) {
  const call = isObject(event.tool_call) ? event.tool_call : event;
  const [name, detail] = Object.entries(call).find(([, v]) => isObject(v)) ?? [];
  const label = (typeof event.name === "string" && event.name) || name?.replace(/ToolCall$/, "") || "tool";
  const args = isObject(detail) && isObject(detail.args) ? detail.args : undefined;
  const target = args ? firstText(args) : undefined;
  return target ? `${label} · ${target}` : label;
}

/** 把 Cursor 的 stream-json 和 Junie 的 json-stream 都压成一行能读的事件；root 是工作树，路径里去掉它。 */
export function parseLogLine(line: string, root?: string): LogEvent | undefined {
  const event = parseEvent(line);
  if (!event || !root) return event;
  return { ...event, text: event.text.replaceAll(`${root}/`, "") };
}

function parseEvent(line: string): LogEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) return undefined;
  let event: unknown;
  try {
    event = JSON.parse(trimmed);
  } catch {
    return { kind: "info", text: trimmed };
  }
  if (!isObject(event)) return { kind: "info", text: trimmed };

  const type = typeof event.type === "string" ? event.type : "";
  const subtype = typeof event.subtype === "string" ? event.subtype : "";

  if (type === "assistant" && isObject(event.message)) {
    const text = contentText(event.message.content);
    return text.trim() ? { kind: "text", text } : undefined;
  }
  if (type === "user" || type === "thinking") return undefined;
  if (type === "session") return { kind: "info", text: "已启动" };
  if (type === "step") {
    const name = typeof event.name === "string" ? event.name : "步骤";
    if (name === "TASK RESULT") return undefined;
    const details = typeof event.details === "string" ? event.details.trim() : "";
    return { kind: "tool", text: details ? `${name} · ${details}` : name };
  }
  if (type === "tool_call" || type.includes("tool")) {
    if (subtype === "completed") return undefined;
    return { kind: "tool", text: toolSummary(event) };
  }
  if (type === "result" && typeof event.duration_ms === "number" && !event.is_error) {
    return { kind: "info", text: `完成 · ${Math.round(event.duration_ms / 1000)} 秒` };
  }
  if (type === "result") {
    const text = typeof event.result === "string" ? event.result : firstText(event) ?? "完成";
    return { kind: event.is_error ? "error" : "result", text };
  }
  if (type === "system" && subtype === "init") {
    const model = typeof event.model === "string" ? event.model : "";
    return { kind: "info", text: model ? `已启动 · ${model}` : "已启动" };
  }
  if (type === "error" || event.error) {
    return { kind: "error", text: firstText(event) ?? (typeof event.error === "string" ? event.error : trimmed) };
  }

  const text = firstText(event);
  if (!text) return undefined;
  return { kind: type.includes("message") || type.includes("assistant") ? "text" : "info", text };
}
