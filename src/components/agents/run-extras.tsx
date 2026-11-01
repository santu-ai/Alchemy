"use client";

import { useRef, useState } from "react";
import {
  CheckIcon,
  CircleDashedIcon,
  Loader2Icon,
  MessageSquarePlusIcon,
  RotateCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import { toast } from "sonner";

import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AGENT_LABELS, type AgentRun, type CheckItem, type CheckOutput, type RunReview } from "@/lib/agents/types";
import { readNdjson } from "@/lib/client/stream";
import { useModels } from "@/lib/client/use-api";
import type { StreamEvent } from "@/lib/types";
import { cn } from "@/lib/utils";

export const currentChecks = (run: AgentRun) => (run.checks?.round === run.round ? run.checks : undefined);

function CheckRow({ item, running, output }: { item: CheckItem; running: boolean; output?: string }) {
  const icon =
    item.exitCode === undefined ? (
      running ? (
        <Loader2Icon className="size-3.5 animate-spin text-muted-foreground" />
      ) : (
        <CircleDashedIcon className="size-3.5 text-muted-foreground" />
      )
    ) : item.exitCode === 0 ? (
      <CheckIcon className="size-3.5 text-success" />
    ) : (
      <XIcon className="size-3.5 text-destructive" />
    );
  const head = (
    <span className="flex min-w-0 items-center gap-2">
      {icon}
      <span className="shrink-0 font-medium">{item.name}</span>
      <code className="min-w-0 flex-1 truncate font-mono text-muted-foreground">{item.command}</code>
      {item.durationMs !== undefined && (
        <span className="shrink-0 text-muted-foreground">{(item.durationMs / 1000).toFixed(1)} 秒</span>
      )}
    </span>
  );
  if (!output?.trim()) return <li className="px-3 py-2">{head}</li>;
  return (
    <li className="px-3 py-2">
      <details open={item.exitCode !== undefined && item.exitCode !== 0}>
        <summary className="cursor-pointer list-none">{head}</summary>
        <pre className="mt-2 max-h-60 overflow-auto rounded-md bg-muted p-2 font-mono whitespace-pre-wrap">{output}</pre>
      </details>
    </li>
  );
}

/** 跑完自动做的类型检查和 lint；改了会执行代码的配置时停下来等确认。 */
export function ChecksSection({
  run,
  outputs,
  onRun,
}: {
  run: AgentRun;
  outputs?: CheckOutput[];
  onRun: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const checks = currentChecks(run);
  if (run.status === "cancelled" && !checks) return null;
  if (!checks) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2Icon className="size-3 animate-spin" />
        准备检查…
      </p>
    );
  }
  if (checks.status === "none") {
    return <p className="text-xs text-muted-foreground">这个仓库没有 typecheck 或 lint 脚本，跳过检查。</p>;
  }

  const running = checks.status === "running";
  const run_ = async () => {
    setBusy(true);
    try {
      await onRun();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <ShieldCheckIcon className="size-4 text-muted-foreground" />
          检查
          <span
            className={cn(
              "text-xs font-normal",
              checks.status === "passed" && "text-success",
              checks.status === "failed" && "text-destructive",
              checks.status === "blocked" && "text-warning",
              running && "text-muted-foreground",
            )}
          >
            {{ passed: "通过", failed: "没通过", blocked: "等你确认", running: "运行中", none: "" }[checks.status]}
          </span>
        </h3>
        {!running && (
          <Button variant={checks.status === "blocked" ? "default" : "ghost"} size="xs" disabled={busy} onClick={run_}>
            {busy ? <Loader2Icon className="animate-spin" /> : <RotateCwIcon />}
            {checks.status === "blocked" ? "确认并运行" : "重跑"}
          </Button>
        )}
      </div>
      {checks.status === "blocked" && (
        <p className="text-xs text-warning">
          Agent 改了 {checks.blockedBy?.join("、")}。检查会执行这些文件里的代码（安装依赖、加载配置），确认没问题再跑。
        </p>
      )}
      <ul className="flex flex-col divide-y rounded-lg border text-xs">
        {checks.items.map((item, index) => (
          <CheckRow
            key={`${item.name}-${index}`}
            item={item}
            running={running}
            output={outputs?.[index]?.output}
          />
        ))}
      </ul>
    </div>
  );
}

const isLocalChatModel = (model: { provider: string; name: string; capabilities?: string[] }) =>
  model.provider === "ollama" &&
  !/[-:]cloud$/i.test(model.name) &&
  !(model.capabilities?.includes("embedding") && !model.capabilities.includes("completion"));

/** 用本机 Ollama 模型审查 diff，代码不出这台电脑。 */
export function ReviewSection({ run, saved }: { run: AgentRun; saved?: RunReview }) {
  const { data } = useModels();
  const models = (data?.models ?? []).filter(isLocalChatModel);
  const [model, setModel] = useState<string>();
  const current = models.find((item) => item.id === model) ?? models.find((item) => item.id === saved?.model) ?? models[0];
  const [live, setLive] = useState<{ round: number; text: string; thinking: boolean; thought: number }>();
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const start = async () => {
    if (!current) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setLive({ round: run.round, text: "", thinking: true, thought: 0 });
    try {
      const res = await fetch(`/api/agents/runs/${run.id}/review`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: current.id }),
        signal: controller.signal,
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `请求失败（${res.status}）`);
      }
      for await (const event of readNdjson<StreamEvent>(res)) {
        if (event.type === "delta") setLive((prev) => prev && { ...prev, text: prev.text + event.content, thinking: false });
        else if (event.type === "thinking") setLive((prev) => prev && { ...prev, thought: prev.thought + event.content.length });
        else if (event.type === "error") throw new Error(event.message);
      }
    } catch (error) {
      if (!controller.signal.aborted) toast.error(`审查失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
      setLive((prev) => prev && { ...prev, thinking: false });
      abortRef.current = null;
    }
  };

  const shown = live?.round === run.round && (busy || live.text) ? live.text : saved?.text;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <SparklesIcon className="size-4 text-muted-foreground" />
          本地审查
          {saved && !busy && <span className="text-xs font-normal text-muted-foreground">{saved.model.slice(7)}</span>}
        </h3>
        <div className="flex items-center gap-1.5">
          {models.length > 0 && (
            <Select
              items={models.map((item) => ({ value: item.id, label: item.name }))}
              value={current?.id ?? null}
              onValueChange={(value) => value && setModel(value)}
            >
              <SelectTrigger size="sm" aria-label="审查用的模型" className="max-w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {models.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {busy ? (
            <Button variant="outline" size="sm" onClick={() => abortRef.current?.abort()}>
              <SquareIcon />
              停止
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled={!current} onClick={start}>
              <SparklesIcon />
              {saved ? "重新审查" : "审查"}
            </Button>
          )}
        </div>
      </div>
      {!data ? null : models.length === 0 ? (
        <p className="text-xs text-muted-foreground">没有可用的本机 Ollama 模型，先在「模型」页拉一个。</p>
      ) : (
        !shown &&
        !busy && <p className="text-xs text-muted-foreground">diff 只发给本机 Ollama，不出这台电脑。</p>
      )}
      {busy && live?.thinking && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2Icon className="size-3 animate-spin" />
          {live.thought > 0 ? `模型在思考，已经想了 ${live.thought} 字…` : "模型在读 diff…"}
        </p>
      )}
      {shown && (
        <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
          <Markdown>{shown}</Markdown>
        </div>
      )}
    </div>
  );
}

/** 同一个工作树、同一个会话里接着提要求。 */
export function ContinueBox({ run, onContinue }: { run: AgentRun; onContinue: (message: string) => Promise<boolean> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      if (await onContinue(text)) setText("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <MessageSquarePlusIcon className="size-4 text-muted-foreground" />
        继续
      </h3>
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) send();
        }}
        placeholder="接着提要求，比如「检查没过，修一下」或「把测试也补上」。⌘ + Enter 发送"
        className="min-h-16"
      />
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {run.resumable
            ? `接着 ${AGENT_LABELS[run.agent]} 原来的会话，在同一个工作树里改。`
            : "没拿到会话编号，会开一个新会话，但还在同一个工作树里。"}
        </p>
        <Button size="sm" disabled={!text.trim() || busy} onClick={send}>
          {busy ? <Loader2Icon className="animate-spin" /> : <MessageSquarePlusIcon />}
          继续
        </Button>
      </div>
    </div>
  );
}
