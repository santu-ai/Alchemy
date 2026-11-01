import "server-only";

import { randomUUID } from "node:crypto";

import {
  PURPOSE_LABELS,
  type InferenceLease,
  type InferencePurpose,
  type RunningModel,
} from "@/lib/types";

const store = globalThis as typeof globalThis & { __alchemyLeases?: Map<string, InferenceLease> };
const leases = (store.__alchemyLeases ??= new Map<string, InferenceLease>());

/**
 * 只登记不拦截：Ollama 自己会排队、在内存不够时卸载闲着的模型。
 * 这里记下是谁在用，好在概览里说清楚为什么某个请求卡着不动。
 */
export function acquireLease(model: string, purpose: InferencePurpose, label?: string) {
  const id = randomUUID();
  leases.set(id, { id, model, purpose, label, startedAt: Date.now() });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    leases.delete(id);
  };
}

export function activeLeases() {
  return [...leases.values()].sort((a, b) => a.startedAt - b.startedAt);
}

const withTag = (name: string) => (name.includes(":") ? name : `${name}:latest`);
/** 等了这么久还没加载出来，才算是在等内存。 */
const WAITING_MS = 8_000;

export function inferenceWarnings(running: RunningModel[], current: InferenceLease[]) {
  const warnings: string[] = [];
  for (const model of running) {
    if (model.gpuPercent !== undefined && model.gpuPercent < 100) {
      warnings.push(`${model.name} 有 ${100 - model.gpuPercent}% 放在 CPU 上，会明显变慢；先卸载别的模型或调小上下文。`);
    }
  }

  const loaded = new Set(running.map((model) => withTag(model.name)));
  for (const lease of current) {
    const model = withTag(lease.model);
    if (lease.purpose === "pull" || loaded.has(model) || Date.now() - lease.startedAt < WAITING_MS) continue;
    const holders = current.filter(
      (other) => other.id !== lease.id && withTag(other.model) !== model && loaded.has(withTag(other.model)),
    );
    if (holders.length === 0) continue;
    const by = holders.map((other) => `${other.model}（${PURPOSE_LABELS[other.purpose]}）`).join("、");
    warnings.push(`${PURPOSE_LABELS[lease.purpose]}要用的 ${lease.model} 还没加载上，可能在等 ${by} 用完腾出内存。`);
  }
  return warnings;
}
