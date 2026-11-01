import "server-only";

import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import type { AgentInfo, AgentKind, IdeId, IdeInfo, RunMode } from "@/lib/agents/types";
import { AGENT_LABELS } from "@/lib/agents/types";

export const execFileAsync = promisify(execFile);

export function expandHome(value: string) {
  return value === "~" || value.startsWith("~/") ? path.join(homedir(), value.slice(1)) : value;
}

export const ALCHEMY_HOME = path.resolve(expandHome(process.env.ALCHEMY_HOME || "~/.alchemy"));

function onPath(name: string) {
  for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, name);
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

function firstExisting(candidates: Array<string | undefined>) {
  return candidates.find((candidate) => candidate && existsSync(candidate));
}

const CURSOR_AGENT_FALLBACK = path.join(
  homedir(),
  "Library/Application Support/Cursor/User/globalStorage/anysphere.cursor-agent-worker/agent-cli/.local/bin/cursor-agent",
);

export function agentBin(kind: AgentKind) {
  if (kind === "cursor") {
    return firstExisting([
      process.env.CURSOR_AGENT_BIN && expandHome(process.env.CURSOR_AGENT_BIN),
      onPath("cursor-agent"),
      CURSOR_AGENT_FALLBACK,
    ]);
  }
  return firstExisting([
    process.env.JUNIE_BIN && expandHome(process.env.JUNIE_BIN),
    onPath("junie"),
    path.join(homedir(), ".local/bin/junie"),
  ]);
}

export const AGENT_MODES: Record<AgentKind, RunMode[]> = {
  cursor: ["edit", "plan"],
  junie: ["edit", "review"],
};

/** 炼丹炉自己的模型密钥不交给外部 Agent。 */
const PRIVATE_ENV = /^(OPENAI|ANTHROPIC|DEEPSEEK|DASHSCOPE|OPENROUTER|ZHIPU|MOONSHOT|CUSTOM_OPENAI|CUSTOM)_/;

export function agentEnv(extra?: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  for (const key of Object.keys(env)) {
    if (PRIVATE_ENV.test(key)) delete env[key];
  }
  return env;
}

const versionCache = new Map<string, { value?: string; at: number }>();

async function versionOf(bin: string) {
  const cached = versionCache.get(bin);
  if (cached && Date.now() - cached.at < 10 * 60_000) return cached.value;
  let value: string | undefined;
  try {
    const { stdout } = await execFileAsync(bin, ["--version"], { timeout: 20_000, env: agentEnv() });
    const line = stdout.trim().split("\n").filter(Boolean).pop();
    value = line?.replace(/^Junie version:\s*/i, "").trim();
  } catch {}
  versionCache.set(bin, { value, at: Date.now() });
  return value;
}

const loginCache = new Map<string, { value?: boolean; at: number }>();

export async function loggedIn(kind: AgentKind, bin: string) {
  if (kind === "cursor" && process.env.CURSOR_API_KEY) return true;
  if (kind === "junie") return process.env.JUNIE_API_KEY ? true : undefined;
  const cached = loginCache.get(bin);
  if (cached && Date.now() - cached.at < 30_000) return cached.value;
  let value: boolean | undefined;
  try {
    const { stdout, stderr } = await execFileAsync(bin, ["status"], { timeout: 20_000, env: agentEnv() });
    value = !/not logged in/i.test(stdout + stderr);
  } catch {}
  loginCache.set(bin, { value, at: Date.now() });
  return value;
}

const refreshing = new Set<string>();

/** 只读缓存，过期就在后台刷新，不让高频的 status 请求等子进程。 */
function peek<T>(cache: Map<string, { value?: T; at: number }>, key: string, ttlMs: number, refresh: () => Promise<unknown>) {
  const cached = cache.get(key);
  if ((!cached || Date.now() - cached.at >= ttlMs) && !refreshing.has(key)) {
    refreshing.add(key);
    void refresh().finally(() => refreshing.delete(key));
  }
  return cached?.value;
}

function peekLogin(kind: AgentKind, bin: string) {
  if (kind === "cursor" && process.env.CURSOR_API_KEY) return true;
  if (kind === "junie") return process.env.JUNIE_API_KEY ? true : undefined;
  return peek(loginCache, bin, 5 * 60_000, () => loggedIn(kind, bin));
}

export function peekAgents() {
  return (["cursor", "junie"] as AgentKind[]).map((kind) => {
    const bin = agentBin(kind);
    return {
      kind,
      label: AGENT_LABELS[kind],
      available: Boolean(bin),
      version: bin ? peek(versionCache, bin, 10 * 60_000, () => versionOf(bin)) : undefined,
      loggedIn: bin ? peekLogin(kind, bin) : undefined,
    };
  });
}

function loginHint(kind: AgentKind, bin: string | undefined) {
  if (kind === "junie") return "在终端运行一次 junie 完成登录，或者在 .env.local 里设置 JUNIE_API_KEY";
  const command = !bin || onPath("cursor-agent") ? "cursor-agent" : `"${bin}"`;
  return `在终端运行 ${command} login，或者在 .env.local 里设置 CURSOR_API_KEY 后重启炼丹炉`;
}

export async function probeAgents(): Promise<AgentInfo[]> {
  const kinds: AgentKind[] = ["cursor", "junie"];
  return Promise.all(
    kinds.map(async (kind) => {
      const bin = agentBin(kind);
      const [version, login] = bin ? await Promise.all([versionOf(bin), loggedIn(kind, bin)]) : [];
      return {
        kind,
        label: AGENT_LABELS[kind],
        available: Boolean(bin),
        path: bin,
        version,
        modes: AGENT_MODES[kind],
        loggedIn: login,
        loginHint: loginHint(kind, bin),
      };
    }),
  );
}

const IDES: Array<{ id: IdeId; label: string }> = [
  { id: "webstorm", label: "WebStorm" },
  { id: "idea", label: "IntelliJ IDEA" },
  { id: "pycharm", label: "PyCharm" },
];

export function ideLauncher(id: IdeId) {
  return firstExisting([
    path.join(homedir(), "Library/Application Support/JetBrains/Toolbox/scripts", id),
    onPath(id),
  ]);
}

/**
 * Toolbox 生成的脚本会给带空格的参数加上字面引号，路径里有空格就打不开。
 * 能从脚本里读出程序位置时，直接用 open 启动并原样传参。
 */
export async function ideCommand(id: IdeId, args: string[]) {
  const launcher = ideLauncher(id);
  if (!launcher) return undefined;
  try {
    const script = await readFile(launcher, "utf8");
    const app = /open -na "([^"]+)"/.exec(script)?.[1];
    if (app && existsSync(app)) return { file: "open", args: ["-na", app, "--args", ...args] };
  } catch {}
  return { file: launcher, args };
}

export function isIdeId(value: unknown): value is IdeId {
  return IDES.some((ide) => ide.id === value);
}

export function probeIdes(): IdeInfo[] {
  return IDES.map((ide) => ({ ...ide, available: Boolean(ideLauncher(ide.id)) }));
}
