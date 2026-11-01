export type AgentKind = "cursor" | "junie";

/** edit 会改代码；plan 和 review 只读。 */
export type RunMode = "edit" | "plan" | "review";

export type RunStatus =
  | "pending"
  | "running"
  | "done"
  | "failed"
  | "cancelled"
  | "lost"
  | "discarded"
  | "merged";

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
  /** 同一个任务派给多个 Agent 时共用，页面上并排显示。 */
  groupId?: string;
  mergedInto?: string;
  mergedCommit?: string;
  /** 第几轮，「继续」一次加一轮。 */
  round: number;
  rounds: RunRound[];
  /** 能接着原会话继续（拿到了 Agent 的会话编号）。 */
  resumable: boolean;
  checks?: RunChecks;
}

export interface RunRound {
  message: string;
  startedAt: number;
  endedAt?: number;
  exitCode?: number;
}

/**
 * none：没有改动或仓库没有检查脚本；blocked：Agent 改了会执行代码的配置，要你点了才跑。
 */
export type CheckStatus = "running" | "passed" | "failed" | "blocked" | "none";

export interface CheckItem {
  name: string;
  command: string;
  exitCode?: number;
  durationMs?: number;
}

export interface RunChecks {
  round: number;
  status: CheckStatus;
  items: CheckItem[];
  /** 让检查停下来等确认的文件。 */
  blockedBy?: string[];
  startedAt?: number;
  endedAt?: number;
}

export interface CheckOutput {
  name: string;
  output: string;
}

export interface RunReview {
  round: number;
  model: string;
  text: string;
  at: number;
}

export interface MergePreview {
  /** 原仓库当前所在的分支，改动会 cherry-pick 到这里。 */
  target: string;
  checks?: RunChecks;
  files: FileChange[];
  /** Agent 自己已经做了的提交数，会和未提交的改动一起带过去。 */
  agentCommits: number;
  message: string;
  nonce: string;
}

export interface PendingRun {
  run: AgentRun;
  nonce: string;
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
  /** 当前轮检查的输出尾部。 */
  checkOutputs?: CheckOutput[];
  /** 当前轮的本地审查，换轮后作废。 */
  review?: RunReview;
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
  merged: "已合并",
};
