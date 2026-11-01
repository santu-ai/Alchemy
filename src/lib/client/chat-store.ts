"use client";

import { uid } from "@/lib/format";
import type { GenerationStats, ThinkMode } from "@/lib/types";
import { createLocalStore } from "./local-store";

export interface UiMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  thinking?: string;
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
}

export const DEFAULT_SETTINGS: ChatSettings = {
  system: "",
  temperatureEnabled: false,
  temperature: 0.7,
  think: "default",
};

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

export function touchSession(id: string, patch: Partial<ChatSession>) {
  updateSession(id, (session) => ({ ...session, ...patch, updatedAt: Date.now() }));
}

export function updateSession(id: string, update: (session: ChatSession) => ChatSession) {
  sessionsStore.set((sessions) => sessions.map((s) => (s.id === id ? update(s) : s)));
}

export function updateMessage(sessionId: string, messageId: string, update: (message: UiMessage) => UiMessage) {
  updateSession(sessionId, (session) => ({
    ...session,
    updatedAt: Date.now(),
    messages: session.messages.map((m) => (m.id === messageId ? update(m) : m)),
  }));
}
