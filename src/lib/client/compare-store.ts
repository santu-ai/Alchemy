"use client";

import type { GenerationStats, ThinkMode } from "@/lib/types";
import { createLocalStore } from "./local-store";

export interface SavedLane {
  model: string;
  content: string;
  thinking: string;
  error?: string;
  stats?: GenerationStats;
  memoryBytes?: number;
  contextLength?: number;
  gpuPercent?: number;
}

export interface CompareRun {
  id: string;
  createdAt: number;
  prompt: string;
  system: string;
  temperature?: number;
  think: ThinkMode;
  numCtx: number;
  /** 用户标出的更好的那一栏，值是模型 id。 */
  preference?: string;
  lanes: SavedLane[];
}

export const compareStore = createLocalStore<CompareRun[]>("workbench.compares.v1", []);
