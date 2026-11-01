"use client";

import { BookmarkIcon, CodeIcon, PlayIcon, PlusIcon, SquareIcon, ThumbsUpIcon, TimerIcon, XIcon, ZapIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssistantContent } from "@/components/assistant-content";
import { chatModels, ModelSelect } from "@/components/model-select";
import { NoModelsNotice } from "@/components/no-models-notice";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { compareStore, type CompareRun } from "@/lib/client/compare-store";
import { DEFAULT_SETTINGS, readSettings } from "@/lib/client/chat-store";
import { createFrameBatcher } from "@/lib/client/frame";
import { useHydrated, useLocalStore } from "@/lib/client/local-store";
import { streamChat } from "@/lib/client/stream";
import { useModels, useStatus } from "@/lib/client/use-api";
import { CONTEXT_OPTIONS } from "@/lib/context";
import { formatBytes, formatContext, formatGpu, formatMs, uid } from "@/lib/format";
import { routeSnippet } from "@/lib/recipe";
import { thinkLabel } from "@/lib/think";
import type { GenerationStats, RunningModel, ThinkMode, ToolTrace } from "@/lib/types";
import { cn } from "@/lib/utils";

interface Lane {
  key: string;
  model?: string;
  content: string;
  thinking: string;
  tools: ToolTrace[];
  error?: string;
  stats?: GenerationStats;
  running: boolean;
}

interface Draft {
  content: string;
  thinking: string;
  tools: ToolTrace[];
  stats?: GenerationStats;
  error?: string;
}

const PROMPTS = [
  "用一段话向 10 岁小孩解释什么是大语言模型。",
  "写一个 Python 函数，判断一个字符串是不是回文，并附上测试。",
  "一个笼子里有鸡和兔共 35 只，脚共 94 只，鸡和兔各几只？请写出推理过程。",
];

const THINK_OPTIONS: { value: ThinkMode; label: string }[] = [
  { value: "default", label: "跟随模型默认" },
  { value: "low", label: "思考 low" },
  { value: "medium", label: "思考 medium" },
  { value: "high", label: "思考 high" },
  { value: "on", label: "开启思考" },
  { value: "off", label: "关闭思考" },
];

const emptyLane = (key: string = uid()): Lane => ({ key, content: "", thinking: "", tools: [], running: false });
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

function loadedOf(modelId: string | undefined, running: RunningModel[]) {
  if (!modelId) return undefined;
  const name = modelId.slice(modelId.indexOf("/") + 1);
  return running.find((model) => model.name === name);
}

export function CompareView() {
  const hydrated = useHydrated();
  const { data, loading } = useModels();
  const models = useMemo(() => data?.models ?? [], [data]);
  const [lanes, setLanes] = useState<Lane[]>(INITIAL_LANES);
  const [prompt, setPrompt] = useState("");
  const [system, setSystem] = useState("");
  const [think, setThink] = useState<ThinkMode>(DEFAULT_SETTINGS.think);
  const [numCtx, setNumCtx] = useState(DEFAULT_SETTINGS.numCtx);
  const [temperatureEnabled, setTemperatureEnabled] = useState(DEFAULT_SETTINGS.temperatureEnabled);
  const [temperature, setTemperature] = useState(DEFAULT_SETTINGS.temperature);
  const [tools, setTools] = useState(DEFAULT_SETTINGS.tools);
  const [preference, setPreference] = useState<string | undefined>();
  const [snippetOpen, setSnippetOpen] = useState(false);
  const runs = useLocalStore(compareStore);
  const controllers = useRef(new Map<string, AbortController>());
  const drafts = useRef(new Map<string, Draft>());
  const starting = useRef(false);
  const synced = useRef(false);

  useEffect(() => {
    if (!hydrated || synced.current) return;
    synced.current = true;
    const settings = readSettings();
    setThink(settings.think);
    setNumCtx(settings.numCtx);
    setTemperatureEnabled(settings.temperatureEnabled);
    setTemperature(settings.temperature);
    setTools(settings.tools);
  }, [hydrated]);

  const usable = chatModels(models);
  const suggested = usable.filter((m) => m.provider !== "demo");
  const resolved = lanes.map((lane, index) => ({
    ...lane,
    model: lane.model ?? (suggested[index] ?? suggested[0] ?? usable[0])?.id,
  }));
  const running = resolved.some((l) => l.running);
  const status = useStatus(running ? 4000 : undefined);
  const fastestStart = best(resolved, (s) => s.ttftMs, "min");
  const fastestGen = best(resolved, (s) => s.tokensPerSecond, "max");
  const preferredLane =
    resolved.find((lane) => lane.model && lane.model === preference) ??
    resolved.find((lane) => lane.content && lane.model) ??
    resolved.find((lane) => lane.model);
  const snippet = preferredLane?.model
    ? routeSnippet({
        modelId: preferredLane.model,
        system,
        temperature: temperatureEnabled ? temperature : undefined,
        think,
        numCtx,
      })
    : "";

  const batch = useRef(
    createFrameBatcher(() => {
      setLanes((prev) =>
        prev.map((lane) => {
          const draft = drafts.current.get(lane.key);
          return draft ? { ...lane, ...draft } : lane;
        }),
      );
    }),
  );

  const patch = (key: string, update: Partial<Lane> | ((lane: Lane) => Partial<Lane>)) =>
    setLanes((prev) =>
      prev.map((lane) => (lane.key === key ? { ...lane, ...(typeof update === "function" ? update(lane) : update) } : lane)),
    );

  const start = () => {
    const text = prompt.trim();
    if (starting.current || running) return;
    if (!text) {
      toast.error("先写一个要对比的问题");
      return;
    }
    if (resolved.some((l) => !l.model)) {
      toast.error("每一栏都需要选择模型");
      return;
    }
    starting.current = true;
    setPreference(undefined);
    batch.current.cancel();
    const temperatureValue = temperatureEnabled ? temperature : undefined;
    for (const lane of resolved) {
      drafts.current.set(lane.key, { content: "", thinking: "", tools: [] });
    }
    setLanes((prev) => prev.map((lane) => ({ ...lane, content: "", thinking: "", tools: [], error: undefined, stats: undefined, running: true })));
    for (const lane of resolved) {
      const controller = new AbortController();
      controllers.current.set(lane.key, controller);
      streamChat(
        {
          model: lane.model!,
          messages: [{ role: "user", content: text }],
          system,
          temperature: temperatureValue,
          think,
          numCtx,
          tools,
          purpose: "compare",
        },
        (event) => {
          const draft = drafts.current.get(lane.key);
          if (!draft) return;
          if (event.type === "delta") draft.content += event.content;
          else if (event.type === "thinking") draft.thinking += event.content;
          else if (event.type === "tool") draft.tools.push(event.trace);
          else if (event.type === "done") draft.stats = event.stats;
          else draft.error = event.message;
          batch.current.push();
        },
        controller.signal,
      )
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            const draft = drafts.current.get(lane.key);
            if (draft) draft.error = error instanceof Error ? error.message : String(error);
          }
        })
        .finally(() => {
          controllers.current.delete(lane.key);
          batch.current.flush();
          patch(lane.key, { running: false });
          if (controllers.current.size === 0) starting.current = false;
        });
    }
  };

  const stopAll = () => controllers.current.forEach((c) => c.abort());

  const save = () => {
    if (!prompt.trim() || resolved.every((lane) => !lane.content && !lane.error)) {
      toast.error("还没有可以保存的对比");
      return;
    }
    const run: CompareRun = {
      id: uid(),
      createdAt: Date.now(),
      prompt: prompt.trim(),
      system,
      temperature: temperatureEnabled ? temperature : undefined,
      think,
      numCtx,
      preference,
      lanes: resolved.map((lane) => {
        const loaded = loadedOf(lane.model, status.data?.ollama.running ?? []);
        return {
          model: lane.model ?? "",
          content: lane.content,
          thinking: lane.thinking,
          error: lane.error,
          stats: lane.stats,
          memoryBytes: loaded?.sizeBytes,
          contextLength: loaded?.contextLength,
          gpuPercent: loaded?.gpuPercent,
        };
      }),
    };
    compareStore.set((prev) => [run, ...prev].slice(0, 20));
    toast.success("已保存这次配方");
  };

  const restore = (run: CompareRun) => {
    setPrompt(run.prompt);
    setSystem(run.system);
    setThink(run.think);
    setNumCtx(run.numCtx);
    setTemperatureEnabled(run.temperature !== undefined);
    if (run.temperature !== undefined) setTemperature(run.temperature);
    setPreference(run.preference);
    setLanes(
      run.lanes.map((lane) => ({
        key: uid(),
        model: lane.model,
        content: lane.content,
        thinking: lane.thinking,
        tools: [],
        error: lane.error,
        stats: lane.stats,
        running: false,
      })),
    );
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-6 sm:px-6">
        <div className="flex flex-col gap-1">
          <h1 className="text-xl font-semibold">模型对比</h1>
          <p className="text-sm text-muted-foreground">
            同一个问题同时发给 2–3 个模型。上下文、思考档和温度对每一栏都相同，结果可以保存并导出成接口。
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
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="flex flex-col gap-2">
              <Label>上下文</Label>
              <Select
                items={CONTEXT_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
                value={String(numCtx)}
                onValueChange={(value) => value && setNumCtx(Number(value))}
                disabled={running}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTEXT_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={String(option.value)}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <Label>思考</Label>
              <Select
                items={THINK_OPTIONS}
                value={think}
                onValueChange={(value) => value && setThink(value)}
                disabled={running}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {THINK_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col gap-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="compare-temperature">温度 {temperatureEnabled ? temperature.toFixed(1) : "默认"}</Label>
                <Switch
                  id="compare-temperature"
                  checked={temperatureEnabled}
                  disabled={running}
                  onCheckedChange={setTemperatureEnabled}
                />
              </div>
              <Slider
                value={[temperature]}
                min={0}
                max={2}
                step={0.1}
                disabled={running || !temperatureEnabled}
                onValueChange={(value) => setTemperature(Array.isArray(value) ? value[0] : value)}
                aria-label="温度"
              />
            </div>
            <div className="flex items-center justify-between gap-3 sm:pt-6">
              <Label htmlFor="compare-tools">本地工具</Label>
              <Switch id="compare-tools" checked={tools} disabled={running} onCheckedChange={setTools} />
            </div>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {lanes.length < 3 ? (
              <Button variant="outline" disabled={running} onClick={() => setLanes((prev) => [...prev, emptyLane()])}>
                <PlusIcon />
                添加一栏
              </Button>
            ) : null}
            <Button variant="outline" disabled={running} onClick={save}>
              <BookmarkIcon />
              保存配方
            </Button>
            <Button variant="outline" disabled={!snippet} onClick={() => setSnippetOpen(true)}>
              <CodeIcon />
              导出接口
            </Button>
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
          {resolved.map((lane) => {
            const loaded = loadedOf(lane.model, status.data?.ollama.running ?? []);
            return (
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
                  {loaded ? (
                    <Badge variant="outline">
                      {[formatBytes(loaded.sizeBytes), formatContext(loaded.contextLength), formatGpu(loaded.gpuPercent)]
                        .filter(Boolean)
                        .join(" · ")}
                    </Badge>
                  ) : null}
                  {!lane.running && lane.content ? (
                    <Button
                      variant={preference === lane.model ? "default" : "ghost"}
                      size="xs"
                      onClick={() => setPreference(lane.model)}
                    >
                      <ThumbsUpIcon />
                      {preference === lane.model ? "更好" : "这一栏更好"}
                    </Button>
                  ) : null}
                </div>
                <div className="flex-1 p-3">
                  {!lane.running && !lane.content && !lane.error && !lane.thinking ? (
                    <p className="py-10 text-center text-sm text-muted-foreground">回答会显示在这里</p>
                  ) : (
                    <AssistantContent
                      content={lane.content}
                      thinking={lane.thinking}
                      tools={lane.tools}
                      error={lane.error}
                      streaming={lane.running}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {runs.length ? (
          <section className="flex flex-col gap-2">
            <h2 className="text-sm font-medium">保存的配方</h2>
            <ul className="divide-y rounded-xl border bg-card">
              {runs.map((run) => (
                <li key={run.id}>
                  <button type="button" className="flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-muted/50" onClick={() => restore(run)}>
                    <span className="line-clamp-1 text-sm">{run.prompt}</span>
                    <span className="text-xs text-muted-foreground">
                      {formatContext(run.numCtx)} · 思考 {thinkLabel(run.think)}
                      {run.preference ? ` · 更好：${run.preference.split("/").slice(1).join("/")}` : ""}
                      {" · "}
                      {run.lanes.map((lane) => lane.model.split("/").slice(1).join("/")).join(" / ")}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>

      <Dialog open={snippetOpen} onOpenChange={setSnippetOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>导出 Route Handler</DialogTitle>
            <DialogDescription>
              按{preference ? "你标出的那一栏" : "当前第一栏"}生成。上下文 {formatContext(numCtx)}，思考{" "}
              {think === "default" ? "跟随模型默认" : thinkLabel(think)}。云端模型的环境变量名需要按 .env.local 再对一下。
            </DialogDescription>
          </DialogHeader>
          <Textarea readOnly value={snippet} className="min-h-72 font-mono text-xs" aria-label="导出的代码" />
          <div className="flex justify-end">
            <Button
              onClick={() => {
                void navigator.clipboard.writeText(snippet);
                toast.success("已复制");
              }}
            >
              复制
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
