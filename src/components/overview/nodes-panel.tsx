"use client";

import Link from "next/link";
import { AlertTriangleIcon, BotIcon, CodeIcon, HardDriveIcon, Loader2Icon, PowerIcon } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { formatBytes } from "@/lib/format";
import { PURPOSE_LABELS, type StatusResponse } from "@/lib/types";
import { cn } from "@/lib/utils";

function duration(ms: number) {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return `${Math.max(1, Math.round(ms / 1000))} 秒`;
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} 小时 ${minutes % 60} 分` : `${Math.floor(hours / 24)} 天 ${hours % 24} 小时`;
}

function NodeRow({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  href,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "ok" | "warn" | "off";
  href?: string;
}) {
  const body = (
    <>
      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex items-center justify-between gap-2 text-sm">
          <span className="font-medium">{label}</span>
          <span
            className={cn(
              "shrink-0 text-xs",
              tone === "ok" && "text-success",
              tone === "warn" && "text-warning",
              tone === "off" && "text-muted-foreground",
            )}
          >
            {value}
          </span>
        </span>
        {hint && <span className="truncate text-xs text-muted-foreground">{hint}</span>}
      </span>
    </>
  );
  const className = "flex items-start gap-3 p-3.5";
  return (
    <li>
      {href ? (
        <Link href={href} className={cn(className, "hover:bg-muted/50")}>
          {body}
        </Link>
      ) : (
        <div className={className}>{body}</div>
      )}
    </li>
  );
}

/** 这台 Mac 上炼丹炉能调度的东西：Agent 命令行、IDE、任务、服务本身，以及谁在用本机模型。 */
export function NodesPanel({ status }: { status: StatusResponse }) {
  const { nodes, inference, warnings } = status;
  const now = status.checkedAt;
  const { runs, service, home } = nodes;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-base font-semibold">本机节点</h2>

      {warnings.length > 0 && (
        <Alert>
          <AlertTriangleIcon />
          <AlertTitle>资源提醒</AlertTitle>
          <AlertDescription>
            <ul className="flex flex-col gap-1">
              {warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <ol className="flex flex-col divide-y rounded-xl border bg-card">
          {nodes.agents.map((agent) => (
            <NodeRow
              key={agent.kind}
              icon={BotIcon}
              label={agent.label}
              value={!agent.available ? "未安装" : agent.loggedIn === false ? "未登录" : "可用"}
              tone={!agent.available ? "off" : agent.loggedIn === false ? "warn" : "ok"}
              hint={agent.available ? [agent.version, agent.loggedIn === undefined && "登录状态未知"].filter(Boolean).join(" · ") : undefined}
              href="/agents"
            />
          ))}
          <NodeRow
            icon={CodeIcon}
            label="JetBrains IDE"
            value={nodes.ides.length ? `${nodes.ides.length} 个` : "没找到"}
            tone={nodes.ides.length ? "ok" : "off"}
            hint={nodes.ides.map((ide) => ide.label).join("、") || "装 Toolbox 并开启脚本后，Agent 改动可以直接在 IDE 里打开"}
          />
          <NodeRow
            icon={BotIcon}
            label="Agent 任务"
            value={runs.running ? `${runs.running} 个在跑` : runs.waiting ? `${runs.waiting} 个待处理` : "空闲"}
            tone={runs.checksFailed ? "warn" : runs.running || runs.waiting ? "ok" : "off"}
            hint={
              [runs.waiting && `${runs.waiting} 个等你合并或丢弃`, runs.checksFailed && `${runs.checksFailed} 个检查没通过`]
                .filter(Boolean)
                .join(" · ") || undefined
            }
            href="/agents"
          />
          <NodeRow
            icon={PowerIcon}
            label="炼丹炉服务"
            value={service.managed ? "常驻" : "手动启动"}
            tone={service.managed ? "ok" : "warn"}
            hint={[
              `已运行 ${duration(now - service.startedAt)}`,
              service.production ? "生产构建" : "开发模式",
              !service.managed && "关掉终端后检查和通知会停，可运行 pnpm service:install 常驻",
            ]
              .filter(Boolean)
              .join(" · ")}
          />
          <NodeRow
            icon={HardDriveIcon}
            label="任务数据"
            value={home.bytes === undefined ? "计算中" : formatBytes(home.bytes)}
            hint={home.path}
          />
        </ol>

        <div className="flex flex-col gap-2 rounded-xl border bg-card p-3.5">
          <span className="text-sm font-medium">正在使用本机模型</span>
          {inference.length === 0 ? (
            <p className="text-xs text-muted-foreground">现在没有炼丹炉发起的本机推理。</p>
          ) : (
            <ul className="flex flex-col gap-1.5 text-xs">
              {inference.map((lease) => {
                const loaded = status.ollama.running.some((model) => model.name === lease.model);
                return (
                  <li key={lease.id} className="flex items-center gap-2">
                    <Loader2Icon
                      className={cn("size-3 shrink-0 animate-spin", loaded || lease.purpose === "pull" ? "text-brand" : "text-warning")}
                    />
                    <span className="font-mono">{lease.model}</span>
                    <span className="text-muted-foreground">
                      {PURPOSE_LABELS[lease.purpose]}
                      {lease.label ? ` · ${lease.label}` : ""} · {duration(now - lease.startedAt)}
                      {!loaded && lease.purpose !== "pull" ? " · 加载中" : ""}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-auto pt-2 text-xs text-muted-foreground">
            Ollama 自己会排队、在内存不够时卸载闲着的模型；这里只说明是谁在用，不会拦你的请求。
          </p>
        </div>
      </div>
    </section>
  );
}
