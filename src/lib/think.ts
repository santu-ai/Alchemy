import type { ThinkMode } from "@/lib/types";

/** 转成 Ollama `think` 字段。`default` 表示不传，让模型用自己的默认档。 */
export function thinkPayload(think?: ThinkMode): boolean | string | undefined {
  if (!think || think === "default") return undefined;
  if (think === "on") return true;
  if (think === "off") return false;
  return think;
}

export function thinkLabel(value: string | boolean) {
  if (value === true || value === "on") return "开启";
  if (value === false || value === "off") return "关闭";
  return String(value);
}
