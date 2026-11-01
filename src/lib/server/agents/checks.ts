import "server-only";

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { lstat, mkdir, readFile, rm, stat, symlink, unlink } from "node:fs/promises";
import path from "node:path";

import type { CheckItem, CheckOutput, RunChecks } from "@/lib/agents/types";
import { agentEnv } from "./env";
import { diffChanges, git, isIgnored } from "./git";
import { alive, readMeta, runFile, updateMeta, type RunMeta } from "./store";

const CHECK_SCRIPTS = ["typecheck", "lint"];

const LOCKFILES: Array<[string, string]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** 检查时会被执行的配置。Agent 改了它们，检查就等你确认，免得绕过 Agent 的沙箱。 */
const RISKY = [
  /(^|\/)package\.json$/,
  /(^|\/)(pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?)$/,
  /(^|\/)[^/]*\.config\.[cm]?[jt]s$/,
  /(^|\/)\.eslintrc/,
  /(^|\/)\.(npmrc|pnpmfile\.cjs|yarnrc\.yml)$/,
];
const DEPENDENCY_FILES = /(^|\/)(package\.json|pnpm-lock\.yaml|yarn\.lock|package-lock\.json|bun\.lockb?)$/;

const checksDir = (meta: RunMeta) => runFile(meta.id, `checks-${meta.round}`);

interface CheckPlan {
  items: CheckItem[];
  blockedBy: string[];
  dependenciesChanged: boolean;
  packageManager: string;
}

/**
 * 命令取自基线提交的 package.json 脚本，不读工作树里的：Agent 改脚本改不了要跑什么。
 * 返回 undefined 表示没什么可检查。
 */
async function planChecks(meta: RunMeta): Promise<CheckPlan | undefined> {
  if (!meta.worktree || !meta.baseCommit) return undefined;
  let pkg: { scripts?: Record<string, unknown>; dependencies?: object; devDependencies?: object };
  try {
    pkg = JSON.parse(await git(meta.repo, ["show", `${meta.baseCommit}:package.json`]));
  } catch {
    return undefined;
  }
  const scripts = pkg.scripts ?? {};
  const names = CHECK_SCRIPTS.filter((name) => typeof scripts[name] === "string");
  if (names.length === 0) return undefined;

  const changes = await diffChanges(meta.worktree, meta.baseCommit);
  if (changes.length === 0) return undefined;
  const blockedBy = changes.map((change) => change.path).filter((file) => RISKY.some((rule) => rule.test(file)));

  const items: CheckItem[] = [];
  const deps = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, unknown>;
  if ("next" in deps && names.includes("typecheck")) items.push({ name: "next typegen", command: "next typegen" });
  for (const name of names) items.push({ name, command: scripts[name] as string });

  return {
    items,
    blockedBy,
    dependenciesChanged: blockedBy.some((file) => DEPENDENCY_FILES.test(file)),
    packageManager: LOCKFILES.find(([file]) => existsSync(path.join(meta.repo, file)))?.[1] ?? "npm",
  };
}

async function isSymlink(file: string) {
  try {
    return (await lstat(file)).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * 依赖没变就借用原仓库的 node_modules（符号链接，git 会忽略它）；变了就在工作树里单独装，
 * 不碰原仓库。approved 表示你已经确认过会执行改动后的配置。
 */
export async function startChecks(id: string, options: { approved?: boolean } = {}) {
  const meta = await readMeta(id);
  const round = meta.round;
  const plan = meta.worktree && existsSync(meta.worktree) ? await planChecks(meta) : undefined;

  if (!plan) {
    await updateMeta(id, (m) => (m.checks = { round, status: "none", items: [] }));
    return;
  }
  if (plan.blockedBy.length > 0 && !options.approved) {
    await updateMeta(id, (m) => (m.checks = { round, status: "blocked", items: plan.items, blockedBy: plan.blockedBy }));
    return;
  }

  const worktree = meta.worktree!;
  const items = [...plan.items];
  const localModules = path.join(worktree, "node_modules");
  const repoModules = path.join(meta.repo, "node_modules");
  const install = { name: "安装依赖", command: `${plan.packageManager} install --prefer-offline` };
  if (plan.dependenciesChanged) {
    if (await isSymlink(localModules)) await unlink(localModules);
    items.unshift(install);
  } else if (!existsSync(localModules) && existsSync(repoModules)) {
    await symlink(repoModules, localModules, "dir");
    // 只写了 `node_modules/` 的仓库不会忽略符号链接，留着它会被合并时一起提交。
    if (!(await isIgnored(worktree, "node_modules"))) {
      await unlink(localModules);
      items.unshift(install);
    }
  }

  const dir = checksDir(meta);
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });
  const script = [
    'dir="$ALCHEMY_CHECKS_DIR"; cd "$1" || exit 97; shift; i=0',
    'for cmd in "$@"; do /bin/sh -c "$cmd" >"$dir/$i.log" 2>&1 </dev/null; echo $? >"$dir/$i.code"; i=$((i+1)); done',
    ': >"$dir/done"',
  ].join("\n");
  const env = agentEnv({ ALCHEMY_CHECKS_DIR: dir, CI: "1", NO_COLOR: "1", FORCE_COLOR: "0" });
  env.PATH = `${path.join(worktree, "node_modules", ".bin")}${path.delimiter}${env.PATH ?? ""}`;
  const child = spawn(
    "/bin/sh",
    ["-c", script, "alchemy-checks", worktree, ...items.map((item) => item.command)],
    { detached: true, stdio: "ignore", env },
  );
  child.unref();

  await updateMeta(id, (m) => {
    m.checks = { round, status: "running", items, startedAt: Date.now() };
    m.checksPid = child.pid;
  });
}

/** 从结果文件里读出每项的退出码和耗时；全部跑完（或进程没了）就定下通过与否。 */
export async function syncChecks(id: string) {
  const meta = await readMeta(id);
  const checks = meta.checks;
  if (!checks || checks.status !== "running" || checks.round !== meta.round) return meta;
  const dir = checksDir(meta);

  let previous = checks.startedAt ?? Date.now();
  const items: CheckItem[] = [];
  for (const [index, item] of checks.items.entries()) {
    const codeFile = path.join(dir, `${index}.code`);
    if (!existsSync(codeFile)) {
      items.push({ ...item });
      continue;
    }
    const code = Number((await readFile(codeFile, "utf8")).trim());
    const finished = (await stat(codeFile)).mtimeMs;
    items.push({ ...item, exitCode: Number.isFinite(code) ? code : 1, durationMs: Math.max(0, finished - previous) });
    previous = finished;
  }

  const done = existsSync(path.join(dir, "done")) || !alive(meta.checksPid);
  const next: RunChecks = { ...checks, items };
  if (done) {
    next.status = items.every((item) => item.exitCode === 0) ? "passed" : "failed";
    next.endedAt = Date.now();
  }
  return updateMeta(id, (m) => {
    if (m.checks?.round === next.round) m.checks = next;
  });
}

export function stopChecks(meta: RunMeta) {
  if (meta.checks?.status !== "running" || !meta.checksPid) return;
  try {
    process.kill(-meta.checksPid, "SIGTERM");
  } catch {}
}

export async function checkOutputs(meta: RunMeta): Promise<CheckOutput[] | undefined> {
  const checks = meta.checks;
  if (!checks || checks.round !== meta.round || checks.items.length === 0) return undefined;
  const dir = checksDir(meta);
  return Promise.all(
    checks.items.map(async (item, index) => {
      const file = path.join(dir, `${index}.log`);
      if (!existsSync(file)) return { name: item.name, output: "" };
      const text = await readFile(file, "utf8");
      return { name: item.name, output: text.length > 6000 ? `…${text.slice(-6000)}` : text };
    }),
  );
}
