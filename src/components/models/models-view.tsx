"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckCircle2Icon,
  CloudIcon,
  CpuIcon,
  DownloadIcon,
  HardDriveIcon,
  MessageSquareIcon,
  PowerOffIcon,
  RefreshCwIcon,
  Trash2Icon,
  TriangleAlertIcon,
} from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { settingsStore } from "@/lib/client/chat-store";
import { ollamaModelAction, pullModel, type PullProgress } from "@/lib/client/stream";
import { useModels, useStatus } from "@/lib/client/use-api";
import { formatBytes, formatContext, formatGpu } from "@/lib/format";
import { thinkLabel } from "@/lib/think";
import { RECOMMENDED_MODELS } from "@/lib/recommended";

interface PullState {
  model: string;
  status: string;
  percent?: number;
  detail?: string;
}

function describe(progress: PullProgress, model: string): PullState {
  const percent =
    progress.total && progress.completed !== undefined
      ? Math.min(100, Math.round((progress.completed / progress.total) * 100))
      : undefined;
  const status = progress.status.startsWith("pulling") && progress.total ? "正在下载" : progress.status;
  const detail =
    progress.total && progress.completed !== undefined
      ? `${formatBytes(progress.completed)} / ${formatBytes(progress.total)}`
      : undefined;
  return { model, status, percent, detail };
}

function Section({ title, description, children, action }: { title: string; description?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold">{title}</h2>
          {description ? <p className="text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function ModelsView() {
  const router = useRouter();
  const models = useModels();
  const status = useStatus();
  const [pull, setPull] = useState<PullState | null>(null);
  const [custom, setCustom] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const pullAbort = useRef<AbortController | null>(null);

  const reachable = status.data?.ollama.reachable;
  const installed = (models.data?.models ?? []).filter((m) => m.provider === "ollama");
  const findInstalled = (name: string) => installed.find((m) => m.name === name || m.name === `${name}:latest`);
  const running = new Map(status.data?.ollama.running.map((model) => [model.name, model]) ?? []);
  const cloud = (models.data?.providers ?? status.data?.providers ?? []).filter((p) => !p.local);
  const cloudCounts = new Map<string, number>();
  for (const m of models.data?.models ?? []) if (!m.local) cloudCounts.set(m.provider, (cloudCounts.get(m.provider) ?? 0) + 1);

  const refresh = () => {
    models.refresh();
    status.refresh();
  };

  const startPull = async (name: string) => {
    const model = name.trim();
    if (!model) return;
    const controller = new AbortController();
    pullAbort.current = controller;
    setPull({ model, status: "准备下载…" });
    try {
      await pullModel(model, (p) => setPull(describe(p, model)), controller.signal);
      toast.success(`${model} 下载完成`);
      setCustom("");
      refresh();
    } catch (error) {
      if (controller.signal.aborted) toast.info("已取消下载");
      else toast.error(`下载失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      pullAbort.current = null;
      setPull(null);
    }
  };

  const act = async (method: "DELETE" | "PATCH", name: string) => {
    setBusy(name);
    try {
      await ollamaModelAction(method, name);
      toast.success(method === "DELETE" ? `已删除 ${name}` : `已从内存卸载 ${name}`);
      refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(null);
    }
  };

  const chatWith = (id: string) => {
    settingsStore.set((prev) => ({ ...prev, model: id }));
    router.push("/chat");
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-6 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-col gap-1">
            <h1 className="text-xl font-semibold">模型管理</h1>
            <p className="text-sm text-muted-foreground">下载、删除本地模型，查看云端服务是否已配置。</p>
          </div>
          <Button variant="outline" size="sm" onClick={refresh}>
            <RefreshCwIcon className={models.loading || status.loading ? "animate-spin" : undefined} />
            刷新
          </Button>
        </div>

        {status.data && !reachable ? (
          <Alert variant="destructive">
            <TriangleAlertIcon />
            <AlertTitle>连接不上 Ollama</AlertTitle>
            <AlertDescription>
              <p>{status.data.ollama.error}</p>
              <p className="mt-1">
                在 Mac 上运行 <code className="rounded bg-muted px-1">open -a Ollama</code>，或在终端运行{" "}
                <code className="rounded bg-muted px-1">ollama serve</code>，然后点右上角「刷新」。
              </p>
            </AlertDescription>
          </Alert>
        ) : null}

        <Section title="下载本地模型" description="按这台 36 GB 的 Mac 排过。名称可在 ollama.com/library 查到，例如 gpt-oss:20b。">
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void startPull(custom);
            }}
          >
            <Input
              value={custom}
              onChange={(event) => setCustom(event.target.value)}
              placeholder="输入模型名称，例如 gemma4:12b"
              aria-label="模型名称"
              disabled={!reachable || pull !== null}
              className="sm:max-w-sm"
            />
            <Button type="submit" disabled={!reachable || pull !== null || !custom.trim()}>
              <DownloadIcon />
              下载
            </Button>
          </form>

          {pull ? (
            <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className="font-medium">{pull.model}</span>
                <Button variant="ghost" size="xs" onClick={() => pullAbort.current?.abort()}>
                  取消
                </Button>
              </div>
              <Progress value={pull.percent ?? null} />
              <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                <span>{pull.status}</span>
                <span>{pull.detail ?? (pull.percent !== undefined ? `${pull.percent}%` : "")}</span>
              </div>
            </div>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {RECOMMENDED_MODELS.map((rec) => {
              const match = findInstalled(rec.name);
              const embedding = rec.name.includes("embed");
              return (
                <div key={rec.name} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{rec.title}</div>
                      <div className="font-mono text-xs text-muted-foreground">{rec.name}</div>
                    </div>
                    <Badge variant="secondary">{rec.size}</Badge>
                  </div>
                  <div className="text-xs font-medium text-brand">{rec.use}</div>
                  <p className="flex-1 text-xs leading-relaxed text-muted-foreground">{rec.note}</p>
                  {match ? (
                    <Button variant="outline" size="sm" onClick={() => chatWith(match.id)} disabled={embedding}>
                      <CheckCircle2Icon className="text-success" />
                      {embedding ? "已安装" : "已安装 · 去对话"}
                    </Button>
                  ) : (
                    <Button variant="secondary" size="sm" disabled={!reachable || pull !== null} onClick={() => void startPull(rec.name)}>
                      <DownloadIcon />
                      下载
                    </Button>
                  )}
                </div>
              );
            })}
          </div>
        </Section>

        <Section
          title="已安装的本地模型"
          description={installed.length ? `共 ${installed.length} 个，占用 ${formatBytes(installed.reduce((s, m) => s + (m.sizeBytes ?? 0), 0))}` : undefined}
        >
          {models.loading && !models.data ? (
            <div className="flex flex-col gap-2">
              <Skeleton className="h-16" />
              <Skeleton className="h-16" />
            </div>
          ) : installed.length === 0 ? (
            <div className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              {reachable ? "还没有本地模型。从上面的推荐里挑一个下载吧，这台机器建议先下 gpt-oss:20b。" : "Ollama 连接后，这里会列出已下载的模型。"}
            </div>
          ) : (
            <ul className="divide-y rounded-xl border bg-card">
              {installed.map((model) => {
                const loaded = running.get(model.name);
                return (
                  <li key={model.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                    <div className="flex min-w-0 flex-1 items-start gap-3">
                      <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted">
                        <CpuIcon className="size-4 text-muted-foreground" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-mono text-sm font-medium">{model.name}</span>
                          {loaded ? <Badge className="bg-success/15 text-success">已加载到内存</Badge> : null}
                        </div>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                          {model.parameterSize ? <span>{model.parameterSize} 参数</span> : null}
                          {model.quantization ? <span>{model.quantization}</span> : null}
                          {model.family ? <span>{model.family}</span> : null}
                          {model.contextLength ? <span>窗口 {formatContext(model.contextLength)}</span> : null}
                          {model.capabilities?.includes("vision") ? <span>可看图</span> : null}
                          {model.capabilities?.includes("tools") ? <span>可调用工具</span> : null}
                          {model.thinkingValues?.length ? (
                            <span>思考 {model.thinkingValues.map((value) => thinkLabel(value)).join(" / ")}</span>
                          ) : null}
                          <span className="inline-flex items-center gap-1">
                            <HardDriveIcon className="size-3" />
                            {formatBytes(model.sizeBytes)}
                          </span>
                          {loaded ? (
                            <span>
                              本次 {formatContext(loaded.contextLength) ?? "上下文未知"}
                              {formatGpu(loaded.gpuPercent) ? ` · ${formatGpu(loaded.gpuPercent)}` : ""}
                              {loaded.sizeBytes ? ` · ${formatBytes(loaded.sizeBytes)}` : ""}
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {!/embed/i.test(model.name) ? (
                        <Button variant="outline" size="sm" onClick={() => chatWith(model.id)}>
                          <MessageSquareIcon />
                          对话
                        </Button>
                      ) : null}
                      {loaded ? (
                        <Button variant="ghost" size="sm" disabled={busy === model.name} onClick={() => void act("PATCH", model.name)}>
                          <PowerOffIcon />
                          卸载
                        </Button>
                      ) : null}
                      <AlertDialog>
                        <AlertDialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`删除 ${model.name}`} disabled={busy === model.name} />}>
                          <Trash2Icon />
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>删除 {model.name}？</AlertDialogTitle>
                            <AlertDialogDescription>
                              将从磁盘删除该模型，释放 {formatBytes(model.sizeBytes)}。之后需要重新下载才能使用。
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>取消</AlertDialogCancel>
                            <AlertDialogAction variant="destructive" onClick={() => void act("DELETE", model.name)}>
                              删除
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        <Section
          title="云端模型服务"
          description="在项目根目录的 .env.local 中填写 API Key，重启开发服务后生效。Key 只在本机服务端使用，不会发给浏览器。"
        >
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {cloud.map((provider) => {
              const error = models.data?.errors.find((e) => e.provider === provider.id);
              const count = cloudCounts.get(provider.id) ?? 0;
              return (
                <div key={provider.id} className="flex flex-col gap-2 rounded-xl border bg-card p-4">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm font-medium">
                      <CloudIcon className="size-4 text-muted-foreground" />
                      {provider.label}
                    </span>
                    {provider.configured ? (
                      error ? (
                        <Badge variant="destructive">连接失败</Badge>
                      ) : (
                        <Badge className="bg-success/15 text-success">已配置</Badge>
                      )
                    ) : (
                      <Badge variant="outline">未配置</Badge>
                    )}
                  </div>
                  <code className="w-fit rounded bg-muted px-1.5 py-0.5 text-[11px] break-all">{provider.envHint}</code>
                  {provider.configured && !error ? (
                    <p className="text-xs text-muted-foreground">{count} 个可用模型</p>
                  ) : null}
                  {error ? <p className="text-xs break-words text-destructive">{error.message}</p> : null}
                </div>
              );
            })}
          </div>
          <p className="text-xs text-muted-foreground">
            还没有 <code className="rounded bg-muted px-1">.env.local</code>？复制{" "}
            <code className="rounded bg-muted px-1">.env.example</code> 即可。详见{" "}
            <Link href="/" className="underline underline-offset-4">
              概览页
            </Link>
            的上手步骤。
          </p>
        </Section>
      </div>
    </div>
  );
}
