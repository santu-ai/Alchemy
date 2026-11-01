import "server-only";

import { spawn } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, open, readdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  AGENT_LABELS,
  MODE_LABELS,
  type AgentKind,
  type AgentRun,
  type MergePreview,
  type PendingRun,
  type RunDetail,
  type RunMode,
} from "@/lib/agents/types";
import { AGENT_MODES, ALCHEMY_HOME, agentBin, agentEnv, loggedIn } from "./env";
import { diffChanges, findRepo, git } from "./git";

interface RunMeta extends AgentRun {
  nonce?: string;
  pid?: number;
  cancelRequested?: boolean;
  mergeNonce?: string;
  mergeNonceAt?: number;
}

const RUNS_DIR = path.join(ALCHEMY_HOME, "runs");
const TREES_DIR = path.join(ALCHEMY_HOME, "worktrees");
const MAX_RUNNING = 3;
const PENDING_TTL_MS = 10 * 60_000;
const LOG_CHUNK = 256 * 1024;
const TASK_PLACEHOLDER = "<任务>";

export class RunError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

const runDir = (id: string) => path.join(RUNS_DIR, id);
const runFile = (id: string, name: string) => path.join(runDir(id), name);

function assertId(id: string) {
  if (!/^[a-z0-9]{6,12}-[a-f0-9]{6}$/.test(id)) throw new RunError("任务编号不对", 404);
}

function publicRun(meta: RunMeta): AgentRun {
  const run: AgentRun & Partial<RunMeta> = { ...meta };
  delete run.nonce;
  delete run.pid;
  delete run.cancelRequested;
  delete run.mergeNonce;
  delete run.mergeNonceAt;
  return run as AgentRun;
}

async function readMeta(id: string): Promise<RunMeta> {
  assertId(id);
  try {
    return JSON.parse(await readFile(runFile(id, "meta.json"), "utf8")) as RunMeta;
  } catch {
    throw new RunError("找不到这个任务", 404);
  }
}

async function writeMeta(meta: RunMeta) {
  const target = runFile(meta.id, "meta.json");
  const temp = `${target}.${process.pid}.tmp`;
  await writeFile(temp, JSON.stringify(meta, null, 2));
  await rename(temp, target);
}

function alive(pid: number | undefined) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** 进程是脱离 Next 跑的，状态只能从文件和 pid 推出来。 */
async function refresh(meta: RunMeta) {
  if (meta.status !== "running") return meta;
  const codeFile = runFile(meta.id, "exit_code");
  if (existsSync(codeFile)) {
    const code = Number((await readFile(codeFile, "utf8")).trim());
    meta.exitCode = Number.isFinite(code) ? code : undefined;
    meta.status = meta.cancelRequested ? "cancelled" : code === 0 ? "done" : "failed";
    meta.endedAt = (await stat(codeFile)).mtimeMs;
  } else if (!alive(meta.pid)) {
    meta.status = meta.cancelRequested ? "cancelled" : "lost";
    meta.endedAt = Date.now();
  } else {
    return meta;
  }
  await writeMeta(meta);
  return meta;
}

function agentArgs(kind: AgentKind, mode: RunMode, task: string, worktree: string) {
  if (kind === "cursor") {
    const args = ["-p", "--output-format", "stream-json", "--trust", "--sandbox", "enabled"];
    if (mode === "plan") args.push("--mode", "plan");
    return [...args, "--workspace", worktree, task];
  }
  const args = ["-p", worktree, "--output-format", "json-stream", "--skip-update-check"];
  if (mode === "review") return ["--review", ...args];
  return ["--task", task, "--max-steps", "60", ...args];
}

async function listMetas() {
  await mkdir(RUNS_DIR, { recursive: true });
  const ids = await readdir(RUNS_DIR);
  const metas = await Promise.all(
    ids.map(async (id) => {
      try {
        return await refresh(await readMeta(id));
      } catch {
        return undefined;
      }
    }),
  );
  return metas.filter((meta): meta is RunMeta => Boolean(meta));
}

export async function listRuns() {
  const metas = await listMetas();
  return metas
    .filter((meta) => meta.status !== "pending" || Date.now() - meta.createdAt < PENDING_TTL_MS)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 50)
    .map(publicRun);
}

export interface CreateRunInput {
  agents: AgentKind[];
  mode: RunMode;
  repo: string;
  task: string;
}

const newId = () => `${Date.now().toString(36)}-${randomBytes(3).toString("hex")}`;

/** 第一步只登记任务、生成一次性口令，不启动任何进程。多个 Agent 时每个一份。 */
export async function createRuns(input: CreateRunInput): Promise<PendingRun[]> {
  const agents = [...new Set(input.agents)];
  if (agents.length === 0 || agents.length > 2) throw new RunError("一次最多派给两个 Agent");
  if (agents.length > 1 && input.mode !== "edit") throw new RunError("并排对比只支持改代码模式");
  const groupId = agents.length > 1 ? newId() : undefined;
  const pending: PendingRun[] = [];
  for (const agent of agents) pending.push(await createRun({ ...input, agent, groupId }));
  return pending;
}

async function createRun(input: Omit<CreateRunInput, "agents"> & { agent: AgentKind; groupId?: string }) {
  if (!AGENT_MODES[input.agent]?.includes(input.mode)) throw new RunError("这个 Agent 不支持该模式");
  const bin = agentBin(input.agent);
  if (!bin) throw new RunError("没有找到这个 Agent 的命令行");
  if ((await loggedIn(input.agent, bin)) === false) throw new RunError(`${AGENT_LABELS[input.agent]} 还没登录`, 401);
  const repo = await findRepo(input.repo);
  if (!repo) throw new RunError("仓库不在白名单里，请设置 ALCHEMY_REPOS", 403);
  const task = input.task.trim();
  if (input.mode !== "review" && !task) throw new RunError("请写清楚任务");
  if (task.length > 20_000) throw new RunError("任务描述太长");

  const id = newId();
  const worktree = path.join(TREES_DIR, `${repo.name}-${id}`);
  const shown = agentArgs(input.agent, input.mode, TASK_PLACEHOLDER, worktree);
  const meta: RunMeta = {
    id,
    agent: input.agent,
    mode: input.mode,
    repo: repo.path,
    repoName: repo.name,
    task,
    status: "pending",
    createdAt: Date.now(),
    worktree,
    branch: `alchemy/${id}`,
    command: [path.basename(bin), ...(task ? shown : shown.filter((arg) => arg !== TASK_PLACEHOLDER))],
    nonce: randomBytes(16).toString("hex"),
    groupId: input.groupId,
  };
  await mkdir(runDir(id), { recursive: true });
  await writeMeta(meta);
  return { run: publicRun(meta), nonce: meta.nonce! };
}

function sameToken(a: string, b: string) {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** 第二步凭口令启动，口令用一次就作废。 */
export async function startRun(id: string, nonce: string) {
  const meta = await readMeta(id);
  if (meta.status !== "pending" || !meta.nonce) throw new RunError("这个任务已经启动过了", 409);
  if (Date.now() - meta.createdAt > PENDING_TTL_MS) throw new RunError("确认已过期，请重新提交", 410);
  if (!sameToken(meta.nonce, nonce)) throw new RunError("确认口令不对", 403);
  meta.nonce = undefined;

  const running = (await listMetas()).filter((item) => item.status === "running").length;
  if (running >= MAX_RUNNING) {
    await writeMeta(meta);
    throw new RunError(`最多同时跑 ${MAX_RUNNING} 个任务`, 429);
  }

  const bin = agentBin(meta.agent);
  const worktree = meta.worktree!;
  try {
    if (!bin) throw new Error("没有找到这个 Agent 的命令行");
    meta.baseCommit = (await git(meta.repo, ["rev-parse", "HEAD"])).trim();
    await mkdir(TREES_DIR, { recursive: true });
    await git(meta.repo, ["worktree", "add", "-b", meta.branch!, worktree, meta.baseCommit], 60_000);

    const out = await open(runFile(id, "out.log"), "a");
    const err = await open(runFile(id, "err.log"), "a");
    const script = 'cd "$1" || exit 97; shift; "$@" </dev/null; echo $? > "$ALCHEMY_EXIT_FILE"';
    const child = spawn(
      "/bin/sh",
      ["-c", script, "alchemy-run", worktree, bin, ...agentArgs(meta.agent, meta.mode, meta.task, worktree)],
      {
        detached: true,
        stdio: ["ignore", out.fd, err.fd],
        env: agentEnv({ ALCHEMY_EXIT_FILE: runFile(id, "exit_code"), NO_COLOR: "1" }),
      },
    );
    child.unref();
    await Promise.all([out.close(), err.close()]);
    if (!child.pid) throw new Error("进程没有启动");

    meta.pid = child.pid;
    meta.status = "running";
    meta.startedAt = Date.now();
  } catch (error) {
    meta.status = "failed";
    meta.endedAt = Date.now();
    meta.error = error instanceof Error ? error.message : String(error);
  }
  await writeMeta(meta);
  return publicRun(meta);
}

async function readFrom(file: string, offset: number, limit: number) {
  if (!existsSync(file)) return { text: "", offset: 0 };
  const handle = await open(file, "r");
  try {
    const { size } = await handle.stat();
    const start = Math.min(Math.max(0, offset), size);
    const length = Math.min(limit, size - start);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, start);
    const lastNewline = buffer.lastIndexOf(0x0a);
    const usable = start + length < size && lastNewline >= 0 ? lastNewline + 1 : length;
    return { text: buffer.subarray(0, usable).toString("utf8"), offset: start + usable };
  } finally {
    await handle.close();
  }
}

async function tail(file: string, bytes: number) {
  if (!existsSync(file)) return "";
  const { size } = await stat(file);
  return (await readFrom(file, Math.max(0, size - bytes), bytes)).text;
}

export async function getRun(id: string, offset: number): Promise<RunDetail> {
  const meta = await refresh(await readMeta(id));
  const log = await readFrom(runFile(id, "out.log"), offset, LOG_CHUNK);
  const detail: RunDetail = {
    run: publicRun(meta),
    log: log.text,
    offset: log.offset,
    stderr: await tail(runFile(id, "err.log"), 4096),
  };
  const finished = meta.status !== "running" && meta.status !== "pending" && meta.status !== "discarded";
  if (finished && meta.worktree && meta.baseCommit && existsSync(meta.worktree)) {
    try {
      detail.changes = await diffChanges(meta.worktree, meta.baseCommit);
    } catch {}
  }
  return detail;
}

export async function cancelRun(id: string) {
  const meta = await refresh(await readMeta(id));
  if (meta.status !== "running" || !meta.pid) throw new RunError("任务没有在运行", 409);
  meta.cancelRequested = true;
  await writeMeta(meta);
  try {
    process.kill(-meta.pid, "SIGTERM");
  } catch {}
  return publicRun(meta);
}

async function removeWorktree(meta: RunMeta) {
  if (meta.worktree && existsSync(meta.worktree)) {
    await git(meta.repo, ["worktree", "remove", "--force", meta.worktree], 60_000);
  }
  if (meta.baseCommit && meta.branch) {
    try {
      await git(meta.repo, ["branch", "-D", meta.branch]);
    } catch {}
  }
}

/** 删掉工作树和分支，改动不要了。 */
export async function discardRun(id: string) {
  const meta = await refresh(await readMeta(id));
  if (meta.status === "running") throw new RunError("先停止任务再丢弃", 409);
  if (meta.status === "merged") throw new RunError("已经合并过了", 409);
  await removeWorktree(meta);
  meta.status = "discarded";
  meta.nonce = undefined;
  await writeMeta(meta);
  return publicRun(meta);
}

const MERGEABLE = new Set(["done", "failed", "cancelled", "lost"]);

/** 合并前的检查：工作树还在、有改动、原仓库干净且停在某个分支上。 */
async function mergeChecks(meta: RunMeta) {
  if (!MERGEABLE.has(meta.status)) throw new RunError("任务还没结束，或者已经处理过了", 409);
  if (!meta.worktree || !meta.baseCommit || !existsSync(meta.worktree)) {
    throw new RunError("工作树已经不在了", 404);
  }
  const target = (await git(meta.repo, ["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")).trim();
  if (!target) throw new RunError("原仓库不在任何分支上（detached HEAD），先切到要合并的分支", 409);
  const dirty = (await git(meta.repo, ["status", "--porcelain"])).trim();
  if (dirty) {
    const count = dirty.split("\n").length;
    throw new RunError(`原仓库有 ${count} 处未提交的改动，先提交或暂存（git stash）再合并`, 409);
  }
  const files = await diffChanges(meta.worktree, meta.baseCommit);
  if (files.length === 0) throw new RunError("工作树里没有改动，不需要合并", 409);
  const agentCommits = Number((await git(meta.worktree, ["rev-list", "--count", `${meta.baseCommit}..HEAD`])).trim());
  return { target, files, agentCommits };
}

function defaultMessage(meta: RunMeta) {
  const firstLine = meta.task.split("\n")[0].trim() || MODE_LABELS[meta.mode];
  const subject = firstLine.length > 72 ? `${firstLine.slice(0, 71)}…` : firstLine;
  return subject;
}

export async function prepareMerge(id: string): Promise<MergePreview> {
  const meta = await refresh(await readMeta(id));
  const checks = await mergeChecks(meta);
  meta.mergeNonce = randomBytes(16).toString("hex");
  meta.mergeNonceAt = Date.now();
  await writeMeta(meta);
  return { ...checks, message: defaultMessage(meta), nonce: meta.mergeNonce };
}

async function conflictedFiles(repo: string) {
  try {
    return (await git(repo, ["diff", "--name-only", "--diff-filter=U"])).trim().split("\n").filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * 在工作树里提交 Agent 的改动，再把基线之后的提交按顺序 cherry-pick 到原仓库当前分支。
 * 冲突就整体回滚，原仓库保持原样。
 */
export async function mergeRun(id: string, nonce: string, message: string) {
  const meta = await refresh(await readMeta(id));
  if (!meta.mergeNonce || !meta.mergeNonceAt) throw new RunError("请先预检再合并", 409);
  if (Date.now() - meta.mergeNonceAt > PENDING_TTL_MS) throw new RunError("确认已过期，请重新合并", 410);
  if (!sameToken(meta.mergeNonce, nonce)) throw new RunError("确认口令不对", 403);
  meta.mergeNonce = undefined;
  meta.mergeNonceAt = undefined;
  await writeMeta(meta);

  const subject = message.trim().split("\n")[0] || defaultMessage(meta);
  const body = message.trim().split("\n").slice(1).join("\n").trim();
  const trailer = `Alchemy-Run: ${meta.id} (${AGENT_LABELS[meta.agent]})`;
  const fullMessage = [subject, body, trailer].filter(Boolean).join("\n\n");

  const { target } = await mergeChecks(meta);
  const worktree = meta.worktree!;
  await git(worktree, ["add", "--all"]);
  const staged = (await git(worktree, ["diff", "--cached", "--name-only"])).trim();
  if (staged) await git(worktree, ["commit", "--quiet", "-m", fullMessage], 120_000);

  const commits = (await git(worktree, ["rev-list", "--reverse", `${meta.baseCommit}..HEAD`]))
    .trim()
    .split("\n")
    .filter(Boolean);
  if (commits.length === 0) throw new RunError("没有可合并的提交", 409);

  try {
    await git(meta.repo, ["cherry-pick", ...commits], 120_000);
  } catch (error) {
    const conflicts = await conflictedFiles(meta.repo);
    try {
      await git(meta.repo, ["cherry-pick", "--abort"]);
    } catch {}
    const detail = conflicts.length
      ? `和 ${target} 上的改动冲突：${conflicts.join("、")}。已回滚，原仓库没有变化；可以在 IDE 里手动合并 ${meta.branch}`
      : `cherry-pick 失败，已回滚：${error instanceof Error ? error.message : String(error)}`;
    throw new RunError(detail, 409);
  }

  meta.mergedInto = target;
  meta.mergedCommit = (await git(meta.repo, ["rev-parse", "HEAD"])).trim();
  await removeWorktree(meta);
  meta.status = "merged";
  await writeMeta(meta);
  return publicRun(meta);
}

export async function runFilePath(id: string, file?: string) {
  const meta = await readMeta(id);
  if (!meta.worktree || !existsSync(meta.worktree)) throw new RunError("工作树已经不在了", 404);
  if (!file) return meta.worktree;
  const target = path.resolve(meta.worktree, file);
  if (!target.startsWith(meta.worktree + path.sep)) throw new RunError("文件不在工作树里", 403);
  return target;
}
