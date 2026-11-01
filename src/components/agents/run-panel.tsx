"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckIcon,
  FileCodeIcon,
  FolderOpenIcon,
  GitBranchIcon,
  Loader2Icon,
  SquareIcon,
  Trash2Icon,
} from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { parseLogLine, type LogEvent } from "@/lib/agents/events";
import {
  AGENT_LABELS,
  MODE_LABELS,
  STATUS_LABELS,
  type AgentRun,
  type FileChange,
  type IdeInfo,
  type RunDetail,
  type RunStatus,
} from "@/lib/agents/types";
import { cn } from "@/lib/utils";

const MAX_EVENTS = 2000;

export type RunView = Omit<RunDetail, "log" | "offset"> & { events: LogEvent[] };

const STATUS_VARIANT: Record<RunStatus, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "outline",
  running: "default",
  done: "secondary",
  failed: "destructive",
  cancelled: "outline",
  lost: "destructive",
  discarded: "outline",
};

export function elapsed(run: AgentRun) {
  if (!run.startedAt) return "";
  const seconds = Math.round(((run.endedAt ?? Date.now()) - run.startedAt) / 1000);
  return seconds < 60 ? `${seconds} 秒` : `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒`;
}

export const isFinished = (run: AgentRun) =>
  run.status !== "running" && run.status !== "pending" && run.status !== "discarded";

export function StatusBadge({ status }: { status: RunStatus }) {
  return (
    <Badge variant={STATUS_VARIANT[status]}>
      {status === "running" && <Loader2Icon className="animate-spin" />}
      {STATUS_LABELS[status]}
    </Badge>
  );
}

/**
 * 轮询日志文件；进程独立于页面，刷新或重启服务都能接着看。
 * 结束后就不再轮询，列表里的状态变了（停止、丢弃）再重新拉一次。
 */
export function useRunDetail(id: string | undefined, status: RunStatus | undefined, onSettled: () => void) {
  const [detail, setDetail] = useState<RunView>();
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
  }, [id, status]);

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

export function ChangeStat({ change }: { change?: FileChange }) {
  if (!change) return <span className="text-muted-foreground">—</span>;
  if (change.deleted) return <span className="text-destructive">已删除</span>;
  return (
    <span>
      {change.added !== undefined && <span className="text-success">+{change.added}</span>}{" "}
      {change.removed !== undefined && <span className="text-destructive">−{change.removed}</span>}
    </span>
  );
}

function ChangeList({ changes, onOpen, canOpen }: { changes: FileChange[]; onOpen: (change: FileChange) => void; canOpen: boolean }) {
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
            <ChangeStat change={change} />
          </span>
          <Button variant="ghost" size="xs" disabled={change.deleted || !canOpen} onClick={() => onOpen(change)}>
            {change.line ? `第 ${change.line} 行` : "打开"}
          </Button>
        </li>
      ))}
    </ul>
  );
}

export interface RunActions {
  open: (runId: string, change?: FileChange) => void;
  cancel: (runId: string) => void;
  discard: (runId: string) => void;
  /** 并排对比时保留这一边，丢弃另一边。 */
  keep?: (runId: string) => void;
}

export function RunPanel({
  detail,
  ide,
  actions,
  showTask = true,
}: {
  detail: RunView;
  ide?: IdeInfo;
  actions: RunActions;
  showTask?: boolean;
}) {
  const { run } = detail;
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [detail.events.length]);

  const hasTree = Boolean(run.worktree) && run.status !== "pending" && run.status !== "discarded";

  return (
    <div className="flex min-w-0 flex-col gap-3">
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
        <div className="flex flex-wrap items-center gap-1.5">
          {actions.keep && isFinished(run) && (
            <Button variant="outline" size="sm" onClick={() => actions.keep?.(run.id)}>
              <CheckIcon />
              保留这一版
            </Button>
          )}
          {hasTree && (
            <Button variant="outline" size="sm" disabled={!ide} onClick={() => actions.open(run.id)}>
              <FolderOpenIcon />
              {ide ? `在 ${ide.label} 打开` : "打开"}
            </Button>
          )}
          {run.status === "running" ? (
            <Button variant="outline" size="sm" onClick={() => actions.cancel(run.id)}>
              <SquareIcon />
              停止
            </Button>
          ) : (
            run.status !== "discarded" && (
              <Button variant="ghost" size="sm" onClick={() => actions.discard(run.id)}>
                <Trash2Icon />
                丢弃
              </Button>
            )
          )}
        </div>
      </div>

      {showTask && run.task && (
        <p className="rounded-lg bg-muted/50 px-3 py-2 text-sm whitespace-pre-wrap">{run.task}</p>
      )}
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
          <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-muted p-2 whitespace-pre-wrap">{detail.stderr}</pre>
        </details>
      )}

      {detail.changes && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">改动 · {detail.changes.length} 个文件</h3>
          <ChangeList
            changes={detail.changes}
            onOpen={(change) => actions.open(run.id, change)}
            canOpen={Boolean(ide)}
          />
          {detail.changes.length > 0 && run.branch && (
            <p className="text-xs text-muted-foreground">
              满意的话在原仓库里合并：<code className="font-mono">git merge {run.branch}</code>
              ，或者在 IDE 的 Git 面板里对比这个分支。
            </p>
          )}
        </div>
      )}
    </div>
  );
}
