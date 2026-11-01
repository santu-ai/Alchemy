"use client";

import Link from "next/link";
import {
  ArrowRightIcon,
  BotIcon,
  BoxesIcon,
  CheckCircle2Icon,
  CircleIcon,
  CloudIcon,
  CodeIcon,
  ColumnsIcon,
  CpuIcon,
  LibraryIcon,
  MemoryStickIcon,
  MessageSquareIcon,
  RocketIcon,
  ServerIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { sessionsStore } from "@/lib/client/chat-store";
import { useHydrated, useLocalStore } from "@/lib/client/local-store";
import { useModels, useStatus } from "@/lib/client/use-api";
import { formatBytes } from "@/lib/format";
import { cn } from "@/lib/utils";

const ACTIONS = [
  { href: "/chat", title: "开始对话", text: "和本地或云端模型聊天，支持思考过程与 Markdown。", icon: MessageSquareIcon },
  { href: "/compare", title: "模型对比", text: "同一个问题发给多个模型，比较质量与速度。", icon: ColumnsIcon },
  { href: "/models", title: "模型管理", text: "一键下载推荐模型，查看云端服务配置。", icon: BoxesIcon },
];

const DIRECTIONS = [
  {
    icon: LibraryIcon,
    title: "个人知识库（RAG）",
    text: "用 nomic-embed-text 把文档转成向量，再让 qwen3 基于检索结果回答。适合整理笔记、论文、公司资料。",
    models: ["nomic-embed-text", "qwen3:14b"],
  },
  {
    icon: BotIcon,
    title: "Agent 与工具调用",
    text: "让模型调用搜索、读写文件、执行代码。先在本地用 gpt-oss 或 qwen3 验证流程，再换成云端强模型上线。",
    models: ["gpt-oss:20b", "qwen3:30b"],
  },
  {
    icon: CodeIcon,
    title: "编程助手",
    text: "本地代码模型离线可用、不泄露代码。用来解释代码、写测试、生成脚本。",
    models: ["qwen2.5-coder:14b"],
  },
  {
    icon: RocketIcon,
    title: "AI 产品原型",
    text: "先在「模型对比」里找到效果与成本平衡的模型，再用 Next.js 或 Python 做出第一个可用版本。",
    models: ["qwen3:8b", "云端 API"],
  },
];

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  loading,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "bad";
  loading?: boolean;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border bg-card p-4">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="size-3.5" />
        {label}
      </div>
      {loading ? (
        <Skeleton className="h-7 w-24" />
      ) : (
        <div
          className={cn(
            "text-xl font-semibold tabular-nums",
            tone === "ok" && "text-success",
            tone === "bad" && "text-destructive",
          )}
        >
          {value}
        </div>
      )}
      {hint ? <div className="truncate text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function OverviewView() {
  const status = useStatus(15000);
  const models = useModels();
  const hydrated = useHydrated();
  const sessions = useLocalStore(sessionsStore);

  const loading = !status.data && status.loading;
  const ollama = status.data?.ollama;
  const local = (models.data?.models ?? []).filter((m) => m.provider === "ollama");
  const localChat = local.filter((m) => !/embed/i.test(m.name));
  const cloudProviders = (status.data?.providers ?? []).filter((p) => !p.local);
  const cloudConfigured = cloudProviders.filter((p) => p.configured);
  const runningBytes = ollama?.running.reduce((s, m) => s + m.sizeBytes, 0) ?? 0;

  const checklist = [
    {
      done: Boolean(ollama?.reachable),
      title: "启动 Ollama",
      text: "在 Mac 上打开 Ollama 应用，它会常驻菜单栏。",
      href: "/models",
    },
    {
      done: localChat.length > 0,
      title: "下载第一个本地模型",
      text: "推荐 qwen3:8b（约 5 GB），中文好、速度快。",
      href: "/models",
    },
    {
      done: hydrated && sessions.length > 0,
      title: "完成第一次对话",
      text: "试试让模型解释一个你最近在学的概念。",
      href: "/chat",
    },
    {
      done: cloudConfigured.length > 0,
      title: "接入一个云端模型（可选）",
      text: "在 .env.local 填写 DEEPSEEK_API_KEY 等，和本地模型对比效果。",
      href: "/models",
    },
  ];
  const doneCount = checklist.filter((c) => c.done).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
        <header className="flex flex-col gap-2">
          <Badge variant="secondary" className="w-fit">
            本地优先 · 数据不出电脑
          </Badge>
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">炼丹炉 <span className="text-muted-foreground">Alchemy</span></h1>
          <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
            在这里试用本地和云端大模型、比较它们的表现，再把好用的组合变成你的产品。
          </p>
        </header>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <StatCard
            icon={ServerIcon}
            label="Ollama"
            loading={loading}
            value={ollama?.reachable ? "运行中" : "未连接"}
            tone={ollama?.reachable ? "ok" : "bad"}
            hint={ollama?.reachable ? `版本 ${ollama.version} · ${ollama.host}` : ollama?.host}
          />
          <StatCard
            icon={CpuIcon}
            label="本地模型"
            loading={!models.data && models.loading}
            value={`${local.length} 个`}
            hint={local.length ? `共 ${formatBytes(local.reduce((s, m) => s + (m.sizeBytes ?? 0), 0))}` : "还没有下载模型"}
          />
          <StatCard
            icon={MemoryStickIcon}
            label="已加载到内存"
            loading={loading}
            value={`${ollama?.running.length ?? 0} 个`}
            hint={runningBytes ? `占用约 ${formatBytes(runningBytes)}` : "空闲 5 分钟后自动卸载"}
          />
          <StatCard
            icon={CloudIcon}
            label="云端服务"
            loading={loading}
            value={`${cloudConfigured.length} / ${cloudProviders.length}`}
            hint={cloudConfigured.length ? cloudConfigured.map((p) => p.label).join("、") : "可选，在 .env.local 配置"}
          />
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
          <section className="flex flex-col gap-3">
            <h2 className="text-base font-semibold">从这里开始</h2>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
              {ACTIONS.map(({ href, title, text, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex flex-col gap-2 rounded-xl border bg-card p-4 transition-colors hover:border-brand/40 hover:bg-brand/5"
                >
                  <span className="flex size-9 items-center justify-center rounded-lg bg-brand/10 text-brand">
                    <Icon className="size-4" />
                  </span>
                  <span className="flex items-center gap-1 text-sm font-medium">
                    {title}
                    <ArrowRightIcon className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                  </span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{text}</span>
                </Link>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold">上手清单</h2>
              <span className="text-xs text-muted-foreground tabular-nums">
                {doneCount} / {checklist.length} 已完成
              </span>
            </div>
            <ol className="flex flex-col divide-y rounded-xl border bg-card">
              {checklist.map((item) => (
                <li key={item.title}>
                  <Link href={item.href} className="flex items-start gap-3 p-3.5 hover:bg-muted/50">
                    {item.done ? (
                      <CheckCircle2Icon className="mt-0.5 size-4 shrink-0 text-success" />
                    ) : (
                      <CircleIcon className="mt-0.5 size-4 shrink-0 text-muted-foreground/50" />
                    )}
                    <span className="flex flex-col gap-0.5">
                      <span className={cn("text-sm font-medium", item.done && "text-muted-foreground line-through")}>
                        {item.title}
                      </span>
                      <span className="text-xs text-muted-foreground">{item.text}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-base font-semibold">可以探索的方向</h2>
            <p className="text-sm text-muted-foreground">按你的 Mac（M5 Max · 36 GB）挑选的入门组合。</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {DIRECTIONS.map(({ icon: Icon, title, text, models: picks }) => (
              <div key={title} className="flex gap-3 rounded-xl border bg-card p-4">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                  <Icon className="size-4" />
                </span>
                <div className="flex flex-col gap-1.5">
                  <span className="text-sm font-medium">{title}</span>
                  <span className="text-xs leading-relaxed text-muted-foreground">{text}</span>
                  <span className="flex flex-wrap gap-1">
                    {picks.map((m) => (
                      <Badge key={m} variant="outline" className="font-mono text-[11px]">
                        {m}
                      </Badge>
                    ))}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border bg-muted/40 p-4 text-sm">
          <h2 className="mb-2 font-semibold">内存与模型大小参考</h2>
          <div className="grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
            <p>
              <span className="font-medium text-foreground">16 GB：</span>7B–8B 模型流畅
            </p>
            <p>
              <span className="font-medium text-foreground">32–36 GB：</span>14B 流畅，30B 量化可用
            </p>
            <p>
              <span className="font-medium text-foreground">64 GB 以上：</span>可以尝试 70B 量化
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
