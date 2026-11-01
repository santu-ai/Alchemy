"use client";

import { BrainIcon, ChevronRightIcon } from "lucide-react";

import { Markdown } from "@/components/markdown";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { splitThinking, statsSummary } from "@/lib/format";
import type { GenerationStats } from "@/lib/types";

export function AssistantContent({
  content,
  thinking,
  streaming,
  error,
  stats,
}: {
  content: string;
  thinking?: string;
  streaming?: boolean;
  error?: string;
  stats?: GenerationStats;
}) {
  const parts = splitThinking(content, thinking);
  const thinkingActive = streaming && (parts.thinkingOpen || (!parts.answer && Boolean(parts.thinking)));
  const waiting = streaming && !parts.answer && !parts.thinking;

  return (
    <div className="flex flex-col gap-2">
      {parts.thinking ? (
        <Collapsible defaultOpen={false}>
          <CollapsibleTrigger className="group flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground">
            <BrainIcon className="size-3.5" />
            {thinkingActive ? "正在思考…" : "思考过程"}
            <ChevronRightIcon className="size-3.5 transition-transform group-data-[panel-open]:rotate-90" />
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 border-l-2 pl-3 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {parts.thinking.trim()}
            </div>
          </CollapsibleContent>
        </Collapsible>
      ) : null}

      {waiting ? (
        <div className="flex items-center gap-1 py-1" aria-label="生成中">
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.3s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground [animation-delay:-0.15s]" />
          <span className="size-1.5 animate-bounce rounded-full bg-muted-foreground" />
        </div>
      ) : null}

      {parts.answer ? <Markdown>{parts.answer}</Markdown> : null}

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {stats && !streaming ? (
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground tabular-nums">
          {statsSummary(stats).map((part) => (
            <span key={part}>{part}</span>
          ))}
        </div>
      ) : null}
    </div>
  );
}
