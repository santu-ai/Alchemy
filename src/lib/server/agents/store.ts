import "server-only";

import { timingSafeEqual } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import type { AgentRun } from "@/lib/agents/types";
import { ALCHEMY_HOME } from "./env";

export interface RunMeta extends Omit<AgentRun, "resumable"> {
  nonce?: string;
  pid?: number;
  cancelRequested?: boolean;
  mergeNonce?: string;
  mergeNonceAt?: number;
  /** Agent 自己的会话编号，「继续」时接上。 */
  sessionId?: string;
  /** 已经发过通知的轮次。 */
  notifiedRound?: number;
  checksPid?: number;
}

export const RUNS_DIR = path.join(ALCHEMY_HOME, "runs");
export const TREES_DIR = path.join(ALCHEMY_HOME, "worktrees");
export const PENDING_TTL_MS = 10 * 60_000;

export class RunError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export const runDir = (id: string) => path.join(RUNS_DIR, id);
export const runFile = (id: string, name: string) => path.join(runDir(id), name);

function assertId(id: string) {
  if (!/^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(id)) throw new RunError("任务编号不对", 404);
}

export function publicRun(meta: RunMeta): AgentRun {
  const run: AgentRun & Partial<RunMeta> = { ...meta, resumable: Boolean(meta.sessionId) };
  delete run.nonce;
  delete run.pid;
  delete run.cancelRequested;
  delete run.mergeNonce;
  delete run.mergeNonceAt;
  delete run.sessionId;
  delete run.notifiedRound;
  delete run.checksPid;
  return run as AgentRun;
}

export async function readMeta(id: string): Promise<RunMeta> {
  assertId(id);
  let meta: RunMeta;
  try {
    meta = JSON.parse(await readFile(runFile(id, "meta.json"), "utf8")) as RunMeta;
  } catch {
    throw new RunError("找不到这个任务", 404);
  }
  meta.round ??= 1;
  meta.rounds ??= [
    { message: meta.task, startedAt: meta.startedAt ?? meta.createdAt, endedAt: meta.endedAt, exitCode: meta.exitCode },
  ];
  return meta;
}

export async function writeMeta(meta: RunMeta) {
  const target = runFile(meta.id, "meta.json");
  const temp = `${target}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(temp, JSON.stringify(meta, null, 2));
  await rename(temp, target);
}

/** 读最新的记录再改，减少和页面请求同时写时互相覆盖。 */
export async function updateMeta(id: string, change: (meta: RunMeta) => void) {
  const meta = await readMeta(id);
  change(meta);
  await writeMeta(meta);
  return meta;
}

export function alive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function sameToken(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}
