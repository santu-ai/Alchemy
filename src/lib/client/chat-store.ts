"use client";

import { uid } from "@/lib/format";
import type { ChatAttachment, GenerationStats, ThinkMode, ToolTrace } from "@/lib/types";
import { createLocalStore, type StoreWriteOptions } from "./local-store";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
  images?: string[];
  attachments?: ChatAttachment[];
  tools?: ToolTrace[];
  model?: string;
  stats?: GenerationStats;
  error?: string;
  createdAt: number;
}

export interface ChatSession {
  id: string;
  title: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messages: UiMessage[];
}

export interface ChatSettings {
  model?: string;
  system: string;
  temperatureEnabled: boolean;
  temperature: number;
  think: ThinkMode;
  numCtx: number;
  tools: boolean;
}

export const DEFAULT_SETTINGS: ChatSettings = {
  system: "",
  temperatureEnabled: false,
  temperature: 0.7,
  think: "default",
  numCtx: 32768,
  tools: false,
};

export function readSettings(): ChatSettings {
  return { ...DEFAULT_SETTINGS, ...settingsStore.get() };
}

export const sessionsStore = createLocalStore<ChatSession[]>("workbench.sessions.v1", []);
export const settingsStore = createLocalStore<ChatSettings>("workbench.settings.v1", DEFAULT_SETTINGS);

export function newMessage(role: UiMessage["role"], content: string, model?: string): UiMessage {
  return { id: uid(), role, content, model, createdAt: Date.now() };
}

export function newSession(firstMessage: string, model: string): ChatSession {
  const now = Date.now();
  return {
    id: uid(),
    title: firstMessage.replace(/\s+/g, " ").slice(0, 28),
    model,
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

export function touchSession(id: string, patch: Partial<ChatSession>, options?: StoreWriteOptions) {
  updateSession(id, (session) => ({ ...session, ...patch, updatedAt: Date.now() }), options);
}

export function updateSession(id: string, update: (session: ChatSession) => ChatSession, options?: StoreWriteOptions) {
  sessionsStore.set((sessions) => sessions.map((s) => (s.id === id ? update(s) : s)), options);
}

export function updateMessage(
  sessionId: string,
  messageId: string,
  update: (message: UiMessage) => UiMessage,
  options?: StoreWriteOptions,
) {
  updateSession(sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((m) => (m.id === messageId ? update(m) : m)),
  }), options);
}
