"use client";

import { useMemo, useState } from "react";
import { CloudIcon, GitBranchIcon, GitMergeIcon, Loader2Icon, PlayIcon } from "lucide-react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AGENT_LABELS,
  MODE_LABELS,
  STATUS_LABELS,
  type AgentKind,
  type AgentRun,
  type AgentsResponse,
  type FileChange,
  type IdeId,
  type MergePreview,
  type PendingRun,
  type RunMode,
} from "@/lib/agents/types";
import { sendJson } from "@/lib/client/agents";
import { useApi } from "@/lib/client/use-api";
import { cn } from "@/lib/utils";
import { ComparePanel } from "./compare-panel";
import { isFinished, RunPanel, StatusBadge, useRunDetail, type RunActions } from "./run-panel";

const BOTH = "both";
const AGENT_ORDER: AgentKind[] = ["cursor", "junie"];

interface Entry {
  key: string;
  runs: AgentRun[];
}

/** 并排派出的任务在列表里合成一项。 */
function groupRuns(runs: AgentRun[]): Entry[] {
  const entries: Entry[] = [];
  const groups = new Map<string, Entry>();
  for (const run of runs) {
    if (!run.groupId) {
      entries.push({ key: run.id, runs: [run] });
      continue;
    }
    let entry = groups.get(run.groupId);
    if (!entry) {
      entry = { key: run.groupId, runs: [] };
      groups.set(run.groupId, entry);
      entries.push(entry);
    }
    entry.runs.push(run);
  }
  for (const entry of groups.values()) {
    entry.runs.sort((a, b) => AGENT_ORDER.indexOf(a.agent) - AGENT_ORDER.indexOf(b.agent));
  }
  return entries;
}

interface Merging {
  run: AgentRun;
  preview: MergePreview;
  message: string;
  /** 并排时另一边，合并后一起丢弃。 */
  rivals: AgentRun[];
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function AgentsView() {
  const { data: env, error: envError, refresh: refreshEnv } = useApi<AgentsResponse>("/api/agents");
  const { data: runsData, refresh: refreshRuns } = useApi<{ runs: AgentRun[] }>("/api/agents/runs", 4000);
  const entries = useMemo(() => groupRuns(runsData?.runs ?? []), [runsData]);

  const [repo, setRepo] = useState<string>();
  const [choice, setChoice] = useState<AgentKind | typeof BOTH>();
  const [mode, setMode] = useState<RunMode>("edit");
  const [task, setTask] = useState("");
  const [ide, setIde] = useState<IdeId>();
  const [pending, setPending] = useState<PendingRun[]>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [merging, setMerging] = useState<Merging>();

  const repos = env?.repos ?? [];
  const agents = env?.agents ?? [];
  const usable = agents.filter((item) => item.available && item.loggedIn !== false);
  const canPair = usable.length >= 2;
  const ides = env?.ides.filter((item) => item.available) ?? [];
  const currentRepo = repos.find((item) => item.path === repo) ?? repos[0];
  const paired = choice === BOTH && canPair;
  const currentAgent = paired
    ? undefined
    : (agents.find((item) => item.kind === choice) ?? usable[0] ?? agents.find((item) => item.available));
  const chosen = paired ? usable : currentAgent ? [currentAgent] : [];
  const modes: RunMode[] = paired ? ["edit"] : (currentAgent?.modes ?? ["edit"]);
  const currentMode = modes.includes(mode) ? mode : modes[0];
  const currentIde = ides.find((item) => item.id === ide) ?? ides[0];

  const entry = entries.find((item) => item.key === selected) ?? entries[0];
  const left = useRunDetail(entry?.runs[0]?.id, entry?.runs[0]?.status, refreshRuns);
  const right = useRunDetail(entry?.runs[1]?.id, entry?.runs[1]?.status, refreshRuns);
  const views = [left, right].filter((view): view is NonNullable<typeof view> => Boolean(view));

  const canSubmit =
    Boolean(currentRepo) &&
    chosen.length > 0 &&
    chosen.every((item) => item.available && item.loggedIn !== false) &&
    (currentMode === "review" || task.trim().length > 0);

  const submit = async () => {
    if (!currentRepo || !canSubmit) return;
    setBusy(true);
    try {
      const { runs } = await sendJson<{ runs: PendingRun[] }>("/api/agents/runs", "POST", {
        agents: chosen.map((item) => item.kind),
        mode: currentMode,
        repo: currentRepo.path,
        task,
      });
      setPending(runs);
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending?.length) return;
    setBusy(true);
    try {
      for (const item of pending) {
        const { run } = await sendJson<{ run: AgentRun }>(`/api/agents/runs/${item.run.id}/start`, "POST", {
          nonce: item.nonce,
        });
        if (run.status === "failed") toast.error(`${AGENT_LABELS[run.agent]}：${run.error ?? "启动失败"}`);
      }
      setSelected(pending[0].run.groupId ?? pending[0].run.id);
      setTask("");
    } catch (error) {
      toast.error(errorText(error));
    } finally {
      setBusy(false);
      setPending(undefined);
      refreshRuns();
    }
  };

  const act = async (label: string, request: () => Promise<unknown>) => {
    try {
      await request();
      refreshRuns();
    } catch (error) {
      toast.error(`${label}失败：${errorText(error)}`);
    }
  };

  const actions: RunActions = {
    open: (runId: string, change?: FileChange) => {
      if (!currentIde) return;
      act("打开", () =>
        sendJson("/api/ide/open", "POST", { runId, ide: currentIde.id, file: change?.path, line: change?.line }),
      );
    },
    cancel: (runId) => act("停止", () => sendJson(`/api/agents/runs/${runId}/cancel`, "POST")),
    discard: (runId) => act("丢弃", () => sendJson(`/api/agents/runs/${runId}`, "DELETE")),
    merge: async (runId) => {
      const run = entry?.runs.find((item) => item.id === runId);
      if (!run) return;
      try {
        const { preview } = await sendJson<{ preview: MergePreview }>(`/api/agents/runs/${runId}/merge`, "POST");
        setMerging({ run, preview, message: preview.message, rivals: rivalsOf(runId) });
      } catch (error) {
        toast.error(`没法合并：${errorText(error)}`);
      }
    },
  };
  const pairActions: RunActions = {
    ...actions,
    keep: (runId) => {
      const others = rivalsOf(runId);
      act("丢弃另一边", () => Promise.all(others.map((run) => sendJson(`/api/agents/runs/${run.id}`, "DELETE"))));
    },
  };

  function rivalsOf(runId: string) {
    return entry?.runs.filter((run) => run.id !== runId && isFinished(run)) ?? [];
  }

  const confirmMerge = async () => {
    if (!merging) return;
    setBusy(true);
    try {
      const { run } = await sendJson<{ run: AgentRun }>(`/api/agents/runs/${merging.run.id}/merge`, "POST", {
        nonce: merging.preview.nonce,
        message: merging.message,
      });
      await Promise.all(
        merging.rivals.map((rival) => sendJson(`/api/agents/runs/${rival.id}`, "DELETE").catch(() => undefined)),
      );
      toast.success(`已合并到 ${run.mergedInto} · ${run.mergedCommit?.slice(0, 7)}`);
      setMerging(undefined);
    } catch (error) {
      toast.error(errorText(error), { duration: 10_000 });
      setMerging(undefined);
    } finally {
      setBusy(false);
      refreshRuns();
      refreshEnv();
    }
  };

  const diff = (file: string) => {
    if (!currentIde || !left || !right) return;
    act("对比", () =>
      sendJson("/api/ide/open", "POST", { runId: left.run.id, against: right.run.id, ide: currentIde.id, file }),
    );
  };

  const isPair = (entry?.runs.length ?? 0) > 1;
  const bothFinished =
    isPair && left && right && isFinished(left.run) && isFinished(right.run) && left.changes && right.changes;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Agent 工作台</h1>
          <p className="text-sm text-muted-foreground">
            把编码任务交给 Cursor CLI 或 Junie CLI，也可以同时交给两个并排比较。每个任务在独立的 git
            工作树和分支里跑，不碰你正在改的目录；结束后列出改动，一键在 JetBrains IDE 里打开到对应行。
          </p>
        </div>

        <Alert>
          <CloudIcon />
          <AlertTitle>代码会离开这台电脑</AlertTitle>
          <AlertDescription>
            这两个 Agent 都用云端模型：Cursor CLI 把代码发给 Cursor，Junie 发给 JetBrains。不会加 --force；Junie
            无头运行会自动信任项目并加载项目里的 MCP 和 hooks，所以只把信得过的仓库加进 ALCHEMY_REPOS。
          </AlertDescription>
        </Alert>

        {envError && (
          <Alert variant="destructive">
            <AlertTitle>读不到本机环境</AlertTitle>
            <AlertDescription>{envError}</AlertDescription>
          </Alert>
        )}

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="flex flex-col gap-2">
              <Label>仓库</Label>
              <Select
                items={repos.map((item) => ({ value: item.path, label: item.name }))}
                value={currentRepo?.path ?? null}
                onValueChange={(value) => value && setRepo(value)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={env ? "没有可用仓库" : "读取中…"} />
                </SelectTrigger>
                <SelectContent>
                  {repos.map((item) => (
                    <SelectItem key={item.path} value={item.path}>
                      {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>Agent</Label>
              <Select
                items={[
                  ...agents.map((item) => ({ value: item.kind, label: item.label })),
                  { value: BOTH, label: "两个都派，并排比较" },
                ]}
                value={paired ? BOTH : (currentAgent?.kind ?? null)}
                onValueChange={(value) => value && setChoice(value as AgentKind | typeof BOTH)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder={env ? "没有找到 Agent" : "读取中…"} />
                </SelectTrigger>
                <SelectContent>
                  {agents.map((item) => (
                    <SelectItem key={item.kind} value={item.kind} disabled={!item.available}>
                      {item.label}
                      <span className="text-muted-foreground">
                        {!item.available ? "未安装" : item.loggedIn === false ? "未登录" : item.version}
                      </span>
                    </SelectItem>
                  ))}
                  <SelectItem value={BOTH} disabled={!canPair}>
                    两个都派，并排比较
                    {!canPair && <span className="text-muted-foreground">需要两个都能用</span>}
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>模式</Label>
              <Select
                items={modes.map((item) => ({ value: item, label: MODE_LABELS[item] }))}
                value={currentMode}
                onValueChange={(value) => value && setMode(value as RunMode)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {modes.map((item) => (
                    <SelectItem key={item} value={item}>
                      {MODE_LABELS[item]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {currentRepo && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="font-mono">{currentRepo.path}</span>
              <span className="flex items-center gap-1">
                <GitBranchIcon className="size-3" />
                {currentRepo.branch}
              </span>
              {currentRepo.dirty > 0 && (
                <span className="text-warning">
                  有 {currentRepo.dirty} 处未提交的改动，工作树从当前提交开始，不会带上它们
                </span>
              )}
            </p>
          )}
          {currentAgent?.available && currentAgent.loggedIn !== true && (
            <p className={cn("text-xs", currentAgent.loggedIn === false ? "text-warning" : "text-muted-foreground")}>
              {currentAgent.loggedIn === false
                ? `${currentAgent.label} 还没登录：${currentAgent.loginHint}。`
                : `查不到 ${currentAgent.label} 的登录状态，跑不起来就${currentAgent.loginHint}。`}
            </p>
          )}
          {paired && (
            <p className="text-xs text-muted-foreground">
              两个 Agent 各开一个工作树，从同一个提交开始做同一件事，结束后按文件对照。
            </p>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-task">任务</Label>
            <Textarea
              id="agent-task"
              value={task}
              onChange={(event) => setTask(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) submit();
              }}
              placeholder={
                currentMode === "review"
                  ? "审查模式会看最近一次提交，可以留空"
                  : "说清楚要改什么、改完怎么验证。⌘ + Enter 提交"
              }
              className="min-h-24"
            />
          </div>
          <div className="flex justify-end">
            <Button onClick={submit} disabled={!canSubmit || busy}>
              {busy && !pending ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              {paired ? "派给两个 Agent" : "派任务"}
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">任务记录</h2>
            {entries.length === 0 && <p className="text-sm text-muted-foreground">还没有派过任务。</p>}
            <ul className="flex flex-col gap-1.5">
              {entries.map((item) => {
                const first = item.runs[0];
                return (
                  <li key={item.key}>
                    <button
                      type="button"
                      onClick={() => setSelected(item.key)}
                      className={cn(
                        "flex w-full flex-col gap-1.5 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                        item.key === entry?.key && "border-ring bg-muted/60",
                      )}
                    >
                      <span className="text-xs text-muted-foreground">
                        {item.runs.map((run) => AGENT_LABELS[run.agent]).join(" ⇄ ")} · {first.repoName}
                      </span>
                      <span className="line-clamp-2">{first.task || MODE_LABELS[first.mode]}</span>
                      <span className="flex flex-wrap gap-1">
                        {item.runs.map((run) => (
                          <StatusBadge key={run.id} status={run.status} />
                        ))}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>

          <div className="flex min-w-0 flex-col gap-4 rounded-xl border bg-card p-4">
            {views.length === 0 ? (
              <p className="text-sm text-muted-foreground">选一个任务查看日志和改动。</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  {views[0].run.task ? (
                    <p className="min-w-0 flex-1 rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">
                      {views[0].run.task}
                    </p>
                  ) : (
                    <span className="flex-1" />
                  )}
                  {ides.length > 1 && (
                    <Select
                      items={ides.map((item) => ({ value: item.id, label: item.label }))}
                      value={currentIde?.id ?? null}
                      onValueChange={(value) => value && setIde(value as IdeId)}
                    >
                      <SelectTrigger size="sm" aria-label="用哪个 IDE 打开">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ides.map((item) => (
                          <SelectItem key={item.id} value={item.id}>
                            {item.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  )}
                </div>

                {bothFinished && <ComparePanel left={left} right={right} ide={currentIde} onDiff={diff} />}

                <div className={cn("grid gap-6", isPair && "xl:grid-cols-2")}>
                  {views.map((view) => {
                    const rivalAlive = views.some((other) => other.run.id !== view.run.id && isFinished(other.run));
                    return (
                      <RunPanel
                        key={view.run.id}
                        detail={view}
                        ide={currentIde}
                        actions={isPair && rivalAlive ? pairActions : actions}
                        showTask={false}
                        mergeTarget={repos.find((item) => item.path === view.run.repo)?.branch}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <Dialog open={Boolean(pending)} onOpenChange={(open) => !open && !busy && setPending(undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>确认启动</DialogTitle>
            <DialogDescription>
              {pending && pending.length > 1
                ? `会从 ${pending[0].run.repoName} 的当前提交给每个 Agent 各开一个工作树和分支，再分别运行下面的命令。`
                : `会先从 ${pending?.[0]?.run.repoName ?? ""} 的当前提交开一个工作树和分支 ${pending?.[0]?.run.branch ?? ""}，再在里面运行下面的命令。`}
            </DialogDescription>
          </DialogHeader>
          {pending?.map((item) => (
            <div key={item.run.id} className="flex min-w-0 flex-col gap-1">
              {pending.length > 1 && (
                <span className="text-xs text-muted-foreground">
                  {AGENT_LABELS[item.run.agent]} · {item.run.branch}
                </span>
              )}
              <pre className="max-h-40 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs break-all whitespace-pre-wrap">
                {item.run.command.join(" ")}
              </pre>
            </div>
          ))}
          {pending?.[0]?.run.mode === "edit" && (
            <p className="text-sm text-muted-foreground">
              改代码模式会在工作树里写文件、跑命令。代码会发到{" "}
              {[...new Set(pending.map((item) => (item.run.agent === "cursor" ? "Cursor" : "JetBrains")))].join(" 和 ")}{" "}
              的云端模型。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setPending(undefined)}>
              取消
            </Button>
            <Button disabled={busy} onClick={confirm}>
              {busy ? <Loader2Icon className="animate-spin" /> : <PlayIcon />}
              启动
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(merging)} onOpenChange={(open) => !open && !busy && setMerging(undefined)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              合并到 {merging?.run.repoName} 的 {merging?.preview.target}
            </DialogTitle>
            <DialogDescription>
              先在工作树里提交 {merging ? AGENT_LABELS[merging.run.agent] : ""} 的改动
              {merging?.preview.agentCommits ? `（连同它自己做的 ${merging.preview.agentCommits} 个提交）` : ""}
              ，再 cherry-pick 到 {merging?.preview.target}。有冲突会整体回滚，原仓库不变。
            </DialogDescription>
          </DialogHeader>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border p-2 font-mono text-xs">
            {merging?.preview.files.map((file) => (
              <li key={file.path} className="flex justify-between gap-3">
                <span className={cn("truncate", file.deleted && "line-through")}>{file.path}</span>
                <span className="shrink-0">
                  {file.added !== undefined && <span className="text-success">+{file.added}</span>}{" "}
                  {file.removed !== undefined && <span className="text-destructive">−{file.removed}</span>}
                </span>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-2">
            <Label htmlFor="merge-message">提交说明</Label>
            <Textarea
              id="merge-message"
              value={merging?.message ?? ""}
              onChange={(event) => setMerging((prev) => prev && { ...prev, message: event.target.value })}
              className="min-h-16 font-mono text-xs"
            />
            <p className="text-xs text-muted-foreground">第一行是标题，末尾会自动加上 Alchemy-Run 标记，方便以后追溯。</p>
          </div>
          {merging && merging.run.status !== "done" && (
            <p className="text-sm text-warning">这个任务没有正常结束（{STATUS_LABELS[merging.run.status]}），改动可能不完整。</p>
          )}
          {merging && merging.rivals.length > 0 && (
            <p className="text-sm text-muted-foreground">
              合并后会丢弃另一边（{merging.rivals.map((run) => AGENT_LABELS[run.agent]).join("、")}）的工作树和分支。
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setMerging(undefined)}>
              取消
            </Button>
            <Button disabled={busy || !merging?.message.trim()} onClick={confirmMerge}>
              {busy ? <Loader2Icon className="animate-spin" /> : <GitMergeIcon />}
              合并
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
