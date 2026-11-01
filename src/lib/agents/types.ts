export type AgentKind = "cursor" | "junie";

/** edit 会改代码；plan 和 review 只读。 */
export type RunMode = "edit" | "plan" | "review";

export type RunStatus = "pending" | "running" | "done" | "failed" | "cancelled" | "lost" | "discarded";

export type IdeId = "webstorm" | "idea" | "pycharm";

export interface AgentInfo {
  kind: AgentKind;
  label: string;
  available: boolean;
  version?: string;
  path?: string;
  modes: RunMode[];
  /** undefined 表示查不到，只能跑起来才知道。 */
  loggedIn?: boolean;
  loginHint?: string;
}

export interface RepoInfo {
  path: string;
  name: string;
  branch: string;
  /** 未提交的改动数。工作树从 HEAD 开始，这些改动不会带过去。 */
  dirty: number;
}

export interface IdeInfo {
  id: IdeId;
  label: string;
  available: boolean;
}

export interface AgentsResponse {
  agents: AgentInfo[];
  repos: RepoInfo[];
  ides: IdeInfo[];
  home: string;
}

export interface AgentRun {
  id: string;
  agent: AgentKind;
  mode: RunMode;
  repo: string;
  repoName: string;
  task: string;
  status: RunStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  worktree?: string;
  branch?: string;
  baseCommit?: string;
  /** 展示用，任务正文换成占位符。 */
  command: string[];
  exitCode?: number;
  error?: string;
}

export interface FileChange {
  path: string;
  added?: number;
  removed?: number;
  /** 第一处改动所在行，用来在 IDE 里跳过去。 */
  line?: number;
  deleted: boolean;
}

export interface RunDetail {
  run: AgentRun;
  log: string;
  offset: number;
  stderr: string;
  changes?: FileChange[];
}

export const AGENT_LABELS: Record<AgentKind, string> = {
  cursor: "Cursor CLI",
  junie: "Junie CLI",
};

export const MODE_LABELS: Record<RunMode, string> = {
  edit: "改代码",
  plan: "只出方案",
  review: "审查最近一次提交",
};

export const STATUS_LABELS: Record<RunStatus, string> = {
  pending: "等待确认",
  running: "运行中",
  done: "已完成",
  failed: "失败",
  cancelled: "已停止",
  lost: "进程已丢失",
  discarded: "已丢弃",
};
