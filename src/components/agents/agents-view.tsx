"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  CloudIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  Loader2Icon,
  PlayIcon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
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
import { parseLogLine, type LogEvent } from "@/lib/agents/events";
import {
  AGENT_LABELS,
  MODE_LABELS,
  STATUS_LABELS,
  type AgentKind,
  type AgentRun,
  type AgentsResponse,
  type FileChange,
  type IdeId,
  type RunDetail,
  type RunMode,
  type RunStatus,
} from "@/lib/agents/types";
import { sendJson } from "@/lib/client/agents";
import { useApi } from "@/lib/client/use-api";
import { cn } from "@/lib/utils";

const MAX_EVENTS = 2000;

const STATUS_VARIANT: Record<RunStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  done: "secondary",
  failed: "destructive",
  cancelled: "outline",
  lost: "destructive",
  discarded: "outline",
};

function elapsed(run: AgentRun) {
  if (!run.startedAt) return "";
  const seconds = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {status === "running" && <Loader2Icon className="animate-spin" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

interface Pending {
  run: AgentRun;
  nonce: string;
}

function useRunDetail(id: string | undefined, onSettled: () => void) {
  const [detail, setDetail] = useState<Omit<RunDetail, "log" | "offset"> & { events: LogEvent[] }>();
  const settledRef = useRef(onSettled);
  useEffect(() => {
    settledRef.current = onSettled;
  });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let offset = 0;
    let partial = "";
    let events: LogEvent[] = [];
    let wasRunning = false;

    const poll = async () => {
      try {
        const res = await fetch(`/api/agents/runs/${id}?offset=${offset}`, { cache: "no-store" });
        const data = (await res.json()) as RunDetail & { error?: string };
        if (cancelled) return;
        if (!res.ok) throw new Error(data.error ?? `请求失败（${res.status}）`);

        offset = data.offset;
        const running = data.run.status === "running";
        const lines = (partial + data.log).split("\n");
        partial = running ? (lines.pop() ?? "") : "";
        const fresh = lines.map(parseLogLine).filter((event): event is LogEvent => Boolean(event));
        if (fresh.length) events = [...events, ...fresh].slice(-MAX_EVENTS);

        setDetail({ run: data.run, stderr: data.stderr, changes: data.changes, events });
        if (wasRunning && !running) settledRef.current();
        wasRunning = running;
        if (running || data.log.length > 0) timer = setTimeout(poll, running ? 1500 : 200);
      } catch (error) {
        if (!cancelled) toast.error(error instanceof Error ? error.message : String(error));
      }
    };
    poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [id]);

  return detail?.run.id === id ? detail : undefined;
}

function EventLine({ event }: { event: LogEvent }) {
  if (event.kind === "text") return <Markdown>{event.text}</Markdown>;
  if (event.kind === "result") {
    return (
      <div className="rounded-md bg-muted px-3 py-2">
        <Markdown>{event.text}</Markdown>
      </div>
    );
  }
  return (
    <p
      className={cn(
        "font-mono text-xs whitespace-pre-wrap",
        event.kind === "tool" && "text-muted-foreground",
        event.kind === "info" && "text-muted-foreground/70",
        event.kind === "error" && "text-destructive",
      )}
    >
      {event.kind === "tool" ? `› ${event.text}` : event.text}
    </p>
  );
}

function ChangeList({
  changes,
  onOpen,
  ideLabel,
}: {
  changes: FileChange[];
  onOpen: (change: FileChange) => void;
  ideLabel?: string;
}) {
  if (!changes.length) return <p className="text-sm text-muted-foreground">工作树里没有改动。</p>;
  return (
    <ul className="flex flex-col divide-y rounded-lg border">
      {changes.map((change) => (
        <li key={change.path} className="flex items-center gap-3 px-3 py-2 text-sm">
          <FileCodeIcon className="size-4 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1 truncate font-mono text-xs", change.deleted && "line-through")}>
            {change.path}
          </span>
          <span className="shrink-0 font-mono text-xs">
            {change.added !== undefined && <span className="text-success">+{change.added}</span>}{" "}
            {change.removed !== undefined && <span className="text-destructive">−{change.removed}</span>}
          </span>
          <Button
            variant="ghost"
            size="xs"
            disabled={change.deleted || !ideLabel}
            onClick={() => onOpen(change)}
          >
            {change.line ? `第 ${change.line} 行` : "打开"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export function AgentsView() {
  const { data: env, error: envError } = useApi<AgentsResponse>("/api/agents");
  const { data: runsData, refresh: refreshRuns } = useApi<{ runs: AgentRun[] }>("/api/agents/runs", 4000);
  const runs = useMemo(() => runsData?.runs ?? [], [runsData]);

  const [repo, setRepo] = useState<string>();
  const [agent, setAgent] = useState<AgentKind>();
  const [mode, setMode] = useState<RunMode>("edit");
  const [task, setTask] = useState("");
  const [ide, setIde] = useState<IdeId>();
  const [pending, setPending] = useState<Pending>();
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string>();

  const repos = env?.repos ?? [];
  const agents = env?.agents ?? [];
  const ides = env?.ides.filter((item) => item.available) ?? [];
  const currentRepo = repos.find((item) => item.path === repo) ?? repos[0];
  const currentAgent =
    agents.find((item) => item.kind === agent) ??
    agents.find((item) => item.available && item.loggedIn !== false) ??
    agents.find((item) => item.available);
  const modes = currentAgent?.modes ?? ["edit"];
  const currentMode = modes.includes(mode) ? mode : modes[0];
  const currentIde = ides.find((item) => item.id === ide) ?? ides[0];
  const selectedId = selected ?? runs[0]?.id;

  const detail = useRunDetail(selectedId, refreshRuns);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail?.events.length]);

  const canSubmit =
    Boolean(currentRepo && currentAgent?.available && currentAgent.loggedIn !== false) &&
    (currentMode === "review" || task.trim().length > 0);

  const submit = async () => {
    if (!currentRepo || !currentAgent || !canSubmit) return;
    setBusy(true);
    try {
      setPending(
        await sendJson<Pending>("/api/agents/runs", "POST", {
          agent: currentAgent.kind,
          mode: currentMode,
          repo: currentRepo.path,
          task,
        }),
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      const { run } = await sendJson<{ run: AgentRun }>(`/api/agents/runs/${pending.run.id}/start`, "POST", {
        nonce: pending.nonce,
      });
      if (run.status === "failed") toast.error(run.error ?? "启动失败");
      setSelected(run.id);
      setTask("");
      refreshRuns();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
      setPending(undefined);
    }
  };

  const act = async (label: string, request: () => Promise<unknown>) => {
    try {
      await request();
      refreshRuns();
    } catch (error) {
      toast.error(`${label}失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const openInIde = (file?: FileChange) => {
    if (!detail || !currentIde) return;
    act("打开", () =>
      sendJson("/api/ide/open", "POST", {
        runId: detail.run.id,
        ide: currentIde.id,
        file: file?.path,
        line: file?.line,
      }),
    );
  };

  const run = detail?.run;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">Agent 工作台</h1>
          <p className="text-sm text-muted-foreground">
            把编码任务交给 Cursor CLI 或 Junie CLI。每个任务在独立的 git 工作树和分支里跑，不碰你正在改的目录；结束后列出改动，一键在
            JetBrains IDE 里打开到对应行。
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
                items={agents.map((item) => ({ value: item.kind, label: item.label }))}
                value={currentAgent?.kind ?? null}
                onValueChange={(value) => value && setAgent(value as AgentKind)}
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
                <span className="text-warning">有 {currentRepo.dirty} 处未提交的改动，工作树从当前提交开始，不会带上它们</span>
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
              派任务
            </Button>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-[18rem_minmax(0,1fr)]">
          <div className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">任务记录</h2>
            {runs.length === 0 && <p className="text-sm text-muted-foreground">还没有派过任务。</p>}
            <ul className="flex flex-col gap-1.5">
              {runs.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(item.id)}
                    className={cn(
                      "flex w-full flex-col gap-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60",
                      item.id === selectedId && "border-ring bg-muted/60",
                    )}
                  >
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs text-muted-foreground">
                        {AGENT_LABELS[item.agent]} · {item.repoName}
                      </span>
                      <StatusBadge status={item.status} />
                    </span>
                    <span className="line-clamp-2">{item.task || MODE_LABELS[item.mode]}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4">
            {!run ? (
              <p className="text-sm text-muted-foreground">选一个任务查看日志和改动。</p>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={run.status} />
                      <span className="text-sm font-medium">
                        {AGENT_LABELS[run.agent]} · {MODE_LABELS[run.mode]}
                      </span>
                      <span className="text-xs text-muted-foreground">{elapsed(run)}</span>
                    </div>
                    {run.branch && run.status !== "discarded" && (
                      <span className="flex items-center gap-1 font-mono text-xs text-muted-foreground">
                        <GitBranchIcon className="size-3" />
                        {run.branch}
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {ides.length > 1 && (
                      <Select
                        items={ides.map((item) => ({ value: item.id, label: item.label }))}
                        value={currentIde?.id ?? null}
                        onValueChange={(value) => value && setIde(value as IdeId)}
                      >
                        <SelectTrigger size="sm">
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
                    {run.worktree && run.status !== "pending" && run.status !== "discarded" && (
                      <Button variant="outline" size="sm" disabled={!currentIde} onClick={() => openInIde()}>
                        <FolderOpenIcon />在 {currentIde?.label ?? "IDE"} 打开工作树
                      </Button>
                    )}
                    {run.status === "running" ? (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => act("停止", () => sendJson(`/api/agents/runs/${run.id}/cancel`, "POST"))}
                      >
                        <SquareIcon />
                        停止
                      </Button>
                    ) : (
                      run.status !== "discarded" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => act("丢弃", () => sendJson(`/api/agents/runs/${run.id}`, "DELETE"))}
                        >
                          <Trash2Icon />
                          丢弃工作树
                        </Button>
                      )
                    )}
                  </div>
                </div>

                {run.task && <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{run.task}</p>}
                {run.error && <p className="text-sm text-destructive">{run.error}</p>}

                <div
                  ref={logRef}
                  className="flex max-h-[28rem] min-h-40 flex-col gap-2 overflow-y-auto rounded-lg border bg-background p-3 text-sm"
                >
                  {detail.events.length === 0 && (
                    <p className="text-muted-foreground">{run.status === "running" ? "等待输出…" : "没有输出。"}</p>
                  )}
                  {detail.events.map((event, index) => (
                    <EventLine key={index} event={event} />
                  ))}
                </div>

                {detail.stderr.trim() && run.status !== "running" && (
                  <details className="text-xs">
                    <summary className="cursor-pointer text-muted-foreground">错误输出</summary>
                    <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-2 whitespace-pre-wrap">
                      {detail.stderr}
                    </pre>
                  </details>
                )}

                {detail.changes && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-sm font-medium">改动 · {detail.changes.length} 个文件</h3>
                    <ChangeList changes={detail.changes} onOpen={openInIde} ideLabel={currentIde?.label} />
                    {detail.changes.length > 0 && run.branch && (
                      <p className="text-xs text-muted-foreground">
                        满意的话在原仓库里合并：<code className="font-mono">git merge {run.branch}</code>
                        ，或者在 IDE 的 Git 面板里对比这个分支。
                      </p>
                    )}
                  </div>
                )}
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
              会先从 {pending?.run.repoName} 的当前提交开一个工作树和分支 {pending?.run.branch}，再在里面运行下面的命令。
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-48 overflow-auto rounded-lg bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-all">
            {pending?.run.command.join(" ")}
          </pre>
          {pending?.run.mode === "edit" && (
            <p className="text-sm text-muted-foreground">
              改代码模式会在工作树里写文件、跑命令。代码会发到{" "}
              {pending.run.agent === "cursor" ? "Cursor" : "JetBrains"} 的云端模型。
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
    </div>
  );
}
