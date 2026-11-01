import type { GenerationStats } from "@/lib/types";

export function formatBytes(bytes?: number) {
  if (!bytes) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 10 || unit === 0 ? 0 : 1)} ${units[unit]}`;
}

export function formatContext(tokens?: number) {
  if (!tokens) return undefined;
  if (tokens % 1024 === 0) return `${tokens / 1024}k`;
  return tokens.toLocaleString("zh-CN");
}

export function formatGpu(percent?: number) {
  if (percent === undefined) return undefined;
  if (percent >= 99) return "100% GPU";
  if (percent <= 0) return "CPU";
  return `${percent}% GPU`;
}

export function formatMs(ms?: number) {
  if (ms === undefined) return "—";
  return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
}

export function statsSummary(stats?: GenerationStats) {
  if (!stats) return [];
  const parts: string[] = [];
  if (stats.ttftMs !== undefined) parts.push(`首字 ${formatMs(stats.ttftMs)}`);
  parts.push(`总耗时 ${formatMs(stats.totalMs)}`);
  if (stats.outputTokens) parts.push(`${stats.outputTokens} tokens`);
  if (stats.tokensPerSecond) parts.push(`${stats.tokensPerSecond.toFixed(1)} tokens/s`);
  return parts;
}

export function splitThinking(content: string, thinking = "") {
  const open = content.indexOf("<think>");
  if (open === -1) return { answer: content, thinking, thinkingOpen: false };
  const close = content.indexOf("</think>", open);
  if (close === -1) {
    return {
      answer: content.slice(0, open),
      thinking: thinking + content.slice(open + 7),
      thinkingOpen: true,
    };
  }
  return {
    answer: (content.slice(0, open) + content.slice(close + 8)).replace(/^\s+/, ""),
    thinking: thinking + content.slice(open + 7, close),
    thinkingOpen: false,
  };
}

export function relativeTime(timestamp: number) {
  const diff = Date.now() - timestamp;
  const minute = 60_000;
  if (diff < minute) return "刚刚";
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 7 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return new Date(timestamp).toLocaleDateString("zh-CN");
}

export function uid() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}
