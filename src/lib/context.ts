export const CONTEXT_OPTIONS = [
  { value: 8192, label: "8k" },
  { value: 32768, label: "32k，这台机器的默认档" },
  { value: 65536, label: "64k，更吃内存" },
] as const;

export type ContextLength = (typeof CONTEXT_OPTIONS)[number]["value"];

export function isContextLength(value: number): value is ContextLength {
  return CONTEXT_OPTIONS.some((option) => option.value === value);
}
