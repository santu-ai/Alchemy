"use client";

import { MessageSquareIcon, PlusIcon, Trash2Icon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ChatSession } from "@/lib/client/chat-store";
import { relativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";

export function SessionList({
  sessions,
  activeId,
  onSelect,
  onNew,
  onDelete,
}: {
  sessions: ChatSession[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="p-3">
        <Button className="w-full justify-start" variant="outline" onClick={onNew}>
          <PlusIcon />
          新对话
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {sessions.length === 0 ? (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">对话记录会保存在这台电脑的浏览器里。</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {sessions.map((session) => (
              <li key={session.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onSelect(session.id)}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 pr-9 text-left text-sm transition-colors",
                    session.id === activeId ? "bg-muted font-medium" : "hover:bg-muted/60",
                  )}
                >
                  <MessageSquareIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{session.title}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {relativeTime(session.updatedAt)}
                    </span>
                  </span>
                </button>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  aria-label={`删除对话 ${session.title}`}
                  className="absolute top-2 right-1.5 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                  onClick={() => onDelete(session.id)}
                >
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
