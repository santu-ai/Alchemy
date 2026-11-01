"use client";

import { CopyIcon, HistoryIcon, PlusIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { AssistantContent } from "@/components/assistant-content";
import { Composer } from "@/components/chat/composer";
import { SessionList } from "@/components/chat/session-list";
import { SettingsSheet } from "@/components/chat/settings-sheet";
import { ModelSelect, pickDefaultModel } from "@/components/model-select";
import { NoModelsNotice } from "@/components/no-models-notice";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  newMessage,
  newSession,
  sessionsStore,
  settingsStore,
  touchSession,
  updateMessage,
  updateSession,
  type ChatSession,
  type UiMessage,
} from "@/lib/client/chat-store";
import { useHydrated, useLocalStore } from "@/lib/client/local-store";
import { streamChat } from "@/lib/client/stream";
import { useModels } from "@/lib/client/use-api";
import { splitThinking } from "@/lib/format";
import type { ChatMessage } from "@/lib/types";

const STARTERS = [
  "用三句话解释什么是 RAG，以及它适合解决什么问题",
  "帮我写一个 Python 脚本，把文件夹里的图片按拍摄日期重命名",
  "本地模型和云端 API 各有什么优缺点？我该怎么选？",
  "给我 5 个适合个人开发者做的 AI 小产品点子，并说明怎么验证",
];

function toHistory(messages: UiMessage[]): ChatMessage[] {
  return messages
    .filter((m) => !m.error || m.content)
    .map((m) => ({
      role: m.role,
      content: m.role === "assistant" ? splitThinking(m.content).answer : m.content,
    }))
    .filter((m) => m.content.trim());
}

export function ChatView() {
  const hydrated = useHydrated();
  const sessions = useLocalStore(sessionsStore);
  const settings = useLocalStore(settingsStore);
  const { data: modelsData, loading: modelsLoading } = useModels();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const sorted = useMemo(() => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt), [sessions]);
  const active = selectedId === null ? undefined : sessions.find((s) => s.id === selectedId);
  const models = useMemo(() => modelsData?.models ?? [], [modelsData]);
  const model = pickDefaultModel(models, active?.model ?? settings.model);
  const streaming = streamingId !== null;
  const messages = active?.messages;

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const chooseModel = (id: string) => {
    settingsStore.set((prev) => ({ ...prev, model: id }));
    if (active) updateSession(active.id, (s) => ({ ...s, model: id }));
  };

  const run = async (session: ChatSession, history: UiMessage[], modelId: string) => {
    const assistant = newMessage("assistant", "", modelId);
    touchSession(session.id, { model: modelId, messages: [...history, assistant] });

    const controller = new AbortController();
    abortRef.current = controller;
    setStreamingId(assistant.id);
    stickToBottom.current = true;
    const current = settingsStore.get();

    try {
      await streamChat(
        {
          model: modelId,
          messages: toHistory(history),
          system: current.system,
          temperature: current.temperatureEnabled ? current.temperature : undefined,
          think: current.think,
        },
        (event) => {
          updateMessage(session.id, assistant.id, (m) => {
            switch (event.type) {
              case "delta":
                return { ...m, content: m.content + event.content };
              case "thinking":
                return { ...m, thinking: (m.thinking ?? "") + event.content };
              case "done":
                return { ...m, stats: event.stats };
              case "error":
                return { ...m, error: event.message };
            }
          });
        },
        controller.signal,
      );
    } catch (error) {
      if (!controller.signal.aborted) {
        const message = error instanceof Error ? error.message : String(error);
        updateMessage(session.id, assistant.id, (m) => ({ ...m, error: `连接中断：${message}` }));
      }
    } finally {
      abortRef.current = null;
      setStreamingId(null);
    }
  };

  const send = (text: string) => {
    if (!model) {
      toast.error("请先选择一个模型");
      return;
    }
    const userMessage = newMessage("user", text);
    let session = active;
    if (!session) {
      const created = newSession(text, model);
      session = created;
      sessionsStore.set((prev) => [created, ...prev]);
      setSelectedId(created.id);
    }
    void run(session, [...session.messages, userMessage], model);
  };

  const regenerate = () => {
    if (!active || !model || streaming) return;
    const lastUser = active.messages.findLastIndex((m) => m.role === "user");
    if (lastUser < 0) return;
    void run(active, active.messages.slice(0, lastUser + 1), model);
  };

  const stop = () => abortRef.current?.abort();

  const newChat = () => {
    stop();
    setSelectedId(null);
    setHistoryOpen(false);
  };

  const deleteSession = (id: string) => {
    if (id === active?.id) {
      stop();
      setSelectedId(null);
    }
    sessionsStore.set((prev) => prev.filter((s) => s.id !== id));
  };

  const selectSession = (id: string) => {
    if (streaming) stop();
    setSelectedId(id);
    setHistoryOpen(false);
    stickToBottom.current = true;
  };

  const sessionList = (
    <SessionList
      sessions={hydrated ? sorted : []}
      activeId={active?.id}
      onSelect={selectSession}
      onNew={newChat}
      onDelete={deleteSession}
    />
  );

  const lastAssistant = messages?.findLast((m) => m.role === "assistant");

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 border-r lg:block">{sessionList}</aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2 sm:px-4">
          <Sheet open={historyOpen} onOpenChange={setHistoryOpen}>
            <SheetTrigger render={<Button variant="ghost" size="icon-sm" className="lg:hidden" aria-label="历史对话" />}>
              <HistoryIcon />
            </SheetTrigger>
            <SheetContent side="left" className="w-72 p-0" showCloseButton={false}>
              <SheetTitle className="sr-only">历史对话</SheetTitle>
              {sessionList}
            </SheetContent>
          </Sheet>
          {modelsLoading && !modelsData ? (
            <Skeleton className="h-8 w-48" />
          ) : (
            <ModelSelect models={models} value={model} onChange={chooseModel} disabled={streaming} />
          )}
          <div className="ml-auto flex items-center gap-1.5">
            <SettingsSheet />
            <Button variant="ghost" size="sm" onClick={newChat} aria-label="新对话">
              <PlusIcon />
              <span className="hidden sm:inline">新对话</span>
            </Button>
          </div>
        </div>

        <div
          ref={scrollRef}
          className="min-h-0 flex-1 overflow-y-auto"
          onScroll={(event) => {
            const el = event.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
          }}
        >
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6">
            <NoModelsNotice data={modelsData} />

            {!messages || messages.length === 0 ? (
              <div className="flex flex-col items-center gap-6 pt-10 text-center sm:pt-16">
                <span className="flex size-12 items-center justify-center rounded-2xl bg-brand/10 text-brand">
                  <SparklesIcon className="size-6" />
                </span>
                <div className="flex flex-col gap-1.5">
                  <h1 className="text-xl font-semibold">今天想探索什么？</h1>
                  <p className="text-sm text-muted-foreground">
                    选择左上角的模型，直接提问。本地模型的对话不会离开你的电脑。
                  </p>
                </div>
                <div className="grid w-full gap-2 sm:grid-cols-2">
                  {STARTERS.map((starter) => (
                    <button
                      key={starter}
                      type="button"
                      disabled={!model}
                      onClick={() => send(starter)}
                      className="rounded-xl border bg-card px-4 py-3 text-left text-sm text-card-foreground transition-colors hover:bg-muted disabled:opacity-50"
                    >
                      {starter}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((message) =>
                message.role === "user" ? (
                  <div key={message.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-4 py-2.5 text-sm whitespace-pre-wrap text-primary-foreground">
                      {message.content}
                    </div>
                  </div>
                ) : (
                  <div key={message.id} className="group flex flex-col gap-1.5">
                    <span className="text-xs text-muted-foreground">{message.model?.split("/").slice(1).join("/")}</span>
                    <AssistantContent
                      content={message.content}
                      thinking={message.thinking}
                      error={message.error}
                      stats={message.stats}
                      streaming={message.id === streamingId}
                    />
                    {message.id !== streamingId && message.content ? (
                      <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="复制回答"
                          onClick={() => {
                            void navigator.clipboard.writeText(splitThinking(message.content).answer);
                            toast.success("已复制");
                          }}
                        >
                          <CopyIcon />
                        </Button>
                        {message.id === lastAssistant?.id ? (
                          <Button variant="ghost" size="icon-xs" aria-label="重新生成" onClick={regenerate}>
                            <RefreshCwIcon />
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ),
              )
            )}
          </div>
        </div>

        <div className="shrink-0 px-4 pb-4">
          <div className="mx-auto w-full max-w-3xl">
            <Composer onSend={send} onStop={stop} streaming={streaming} disabled={!model} />
            <p className="mt-2 text-center text-[11px] text-muted-foreground">
              模型可能出错，重要信息请自行核实。
            </p>
          </div>
        </div>
      </section>
    </div>
  );
}
