"use client";

import { PlayIcon, PlusIcon, SquareIcon, TimerIcon, XIcon, ZapIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssistantContent } from "@/components/assistant-content";
import { chatModels, ModelSelect } from "@/components/model-select";
import { NoModelsNotice } from "@/components/no-models-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { streamChat } from "@/lib/client/stream";
import { useModels } from "@/lib/client/use-api";
import { formatMs, uid } from "@/lib/format";
import type { GenerationStats } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Lane {
  key: string;
  model?: string;
  content: string;
  thinking: string;
  error?: string;
  stats?: GenerationStats;
  running: boolean;
}

const PROMPTS = [
  "用一段话向 10 岁小孩解释什么是大语言模型。",
  "写一个 Python 函数，判断一个字符串是不是回文，并附上测试。",
  "一个笼子里有鸡和兔共 35 只，脚共 94 只，鸡和兔各几只？请写出推理过程。",
];

const emptyLane = (key: string = uid()): Lane => ({ key, content: "", thinking: "", running: false });
const INITIAL_LANES = [emptyLane("lane-a"), emptyLane("lane-b")];

function best(lanes: Lane[], pick: (s: GenerationStats) => number | undefined, mode: "min" | "max") {
  let winner: string | undefined;
  let value: number | undefined;
  for (const lane of lanes) {
    const v = lane.stats ? pick(lane.stats) : undefined;
    if (v === undefined) continue;
    if (value === undefined || (mode === "min" ? v < value : v > value)) {
      value = v;
      winner = lane.key;
    }
  }
  return lanes.filter((l) => l.stats).length > 1 ? winner : undefined;
}

export function CompareView() {
  const { data, loading } = useModels();
  const models = useMemo(() => data?.models ?? [], [data]);
  const [lanes, setLanes] = useState<Lane[]>(INITIAL_LANES);
  const [prompt, setPrompt] = useState("");
  const [system, setSystem] = useState("");
  const controllers = useRef(new Map<string, AbortController>());

  const usable = chatModels(models);
  const suggested = usable.filter((m) => m.provider !== "demo");
  const resolved = lanes.map((lane, index) => ({
    ...lane,
    model: lane.model ?? (suggested[index] ?? suggested[0] ?? usable[0])?.id,
  }));
  const running = resolved.some((l) => l.running);
  const fastestStart = best(resolved, (s) => s.ttftMs, "min");
  const fastestGen = best(resolved, (s) => s.tokensPerSecond, "max");

  const patch = (key: string, update: Partial<Lane> | ((lane: Lane) => Partial<Lane>)) =>
    setLanes((prev) =>
      prev.map((lane) => (lane.key === key ? { ...lane, ...(typeof update === "function" ? update(lane) : update) } : lane)),
    );

  const start = () => {
    const text = prompt.trim();
    if (!text) {
      toast.error("先写一个要对比的问题");
      return;
    }
    if (resolved.some((l) => !l.model)) {
      toast.error("每一栏都需要选择模型");
      return;
    }
    for (const lane of resolved) {
      const controller = new AbortController();
      controllers.current.set(lane.key, controller);
      patch(lane.key, { model: lane.model, content: "", thinking: "", error: undefined, stats: undefined, running: true });
      streamChat(
        { model: lane.model!, messages: [{ role: "user", content: text }], system },
        (event) => {
          if (event.type === "delta") patch(lane.key, (l) => ({ content: l.content + event.content }));
          else if (event.type === "thinking") patch(lane.key, (l) => ({ thinking: l.thinking + event.content }));
          else if (event.type === "done") patch(lane.key, { stats: event.stats });
          else patch(lane.key, { error: event.message });
        },
        controller.signal,
      )
        .catch((error: unknown) => {
          if (!controller.signal.aborted) patch(lane.key, { error: error instanceof Error ? error.message : String(error) });
        })
        .finally(() => {
          controllers.current.delete(lane.key);
          patch(lane.key, { running: false });
        });
    }
  };

  const stopAll = () => controllers.current.forEach((c) => c.abort());

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">模型对比</h1>
          <p className="text-sm text-muted-foreground">
            同一个问题同时发给 2–3 个模型，直接比较回答质量、首字延迟和生成速度。
          </p>
        </div>

        <NoModelsNotice data={data} />

        <div className="flex flex-col gap-3 rounded-xl border bg-card p-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="compare-prompt">问题</Label>
            <Textarea
              id="compare-prompt"
              value={prompt}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) start();
              }}
              placeholder="输入要对比的问题，⌘ + Enter 开始"
              className="min-h-24"
            />
            <div className="flex flex-wrap gap-1.5">
              {PROMPTS.map((p) => (
                <Button key={p} variant="secondary" size="xs" onClick={() => setPrompt(p)} className="max-w-full">
                  <span className="truncate">{p}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="compare-system" className="text-muted-foreground">
              系统提示词（可选）
            </Label>
            <Textarea
              id="compare-system"
              value={system}
              onChange={(event) => setSystem(event.target.value)}
              placeholder="所有模型共用同一个系统提示词"
              className="min-h-10"
            />
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lanes.length < 3 ? (
              <Button variant="outline" disabled={running} onClick={() => setLanes((prev) => [...prev, emptyLane()])}>
                <PlusIcon />
                添加一栏
              </Button>
            ) : null}
            {running ? (
              <Button variant="secondary" onClick={stopAll}>
                <SquareIcon className="fill-current" />
                停止
              </Button>
            ) : (
              <Button onClick={start} disabled={loading && !data}>
                <PlayIcon />
                开始对比
              </Button>
            )}
          </div>
        </div>

        <div className={cn("grid gap-4", lanes.length === 3 ? "lg:grid-cols-3" : "md:grid-cols-2")}>
          {resolved.map((lane) => (
            <div key={lane.key} className="flex min-h-64 flex-col rounded-xl border bg-card">
              <div className="flex items-center gap-2 border-b p-3">
                {loading && !data ? (
                  <Skeleton className="h-8 flex-1" />
                ) : (
                  <ModelSelect
                    models={models}
                    value={lane.model}
                    onChange={(id) => patch(lane.key, { model: id })}
                    disabled={running}
                    className="min-w-0 flex-1"
                  />
                )}
                {lanes.length > 2 ? (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="移除这一栏"
                    disabled={running}
                    onClick={() => setLanes((prev) => prev.filter((l) => l.key !== lane.key))}
                  >
                    <XIcon />
                  </Button>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-1.5 px-3 pt-3">
                {lane.stats ? (
                  <>
                    <Badge variant={fastestStart === lane.key ? "default" : "secondary"}>
                      <TimerIcon />
                      首字 {formatMs(lane.stats.ttftMs)}
                    </Badge>
                    {lane.stats.tokensPerSecond ? (
                      <Badge variant={fastestGen === lane.key ? "default" : "secondary"}>
                        <ZapIcon />
                        {lane.stats.tokensPerSecond.toFixed(1)} tokens/s
                      </Badge>
                    ) : null}
                    <Badge variant="outline">总计 {formatMs(lane.stats.totalMs)}</Badge>
                  </>
                ) : lane.running ? (
                  <Badge variant="outline">生成中…</Badge>
                ) : null}
              </div>
              <div className="flex-1 p-3">
                {!lane.running && !lane.content && !lane.error && !lane.thinking ? (
                  <p className="py-10 text-center text-sm text-muted-foreground">回答会显示在这里</p>
                ) : (
                  <AssistantContent
                    content={lane.content}
                    thinking={lane.thinking}
                    error={lane.error}
                    streaming={lane.running}
                  />
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
