"use client";

import { useCallback, useEffect, useState } from "react";

import type { ModelsResponse, StatusResponse } from "@/lib/types";

interface ApiState<T> {
  data?: T;
  error?: string;
  loading: boolean;
}

export function useApi<T>(url: string, intervalMs?: number) {
  const [state, setState] = useState<ApiState<T>>({ loading: true });
  const [tick, setTick] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    fetch(url, { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(`请求失败（${res.status}）`);
        return (await res.json()) as T;
      })
      .then((data) => setState({ data, loading: false }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState((prev) => ({
          data: prev.data,
          loading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      });
    return () => controller.abort();
  }, [url, tick]);

  useEffect(() => {
    if (!intervalMs) return;
    const timer = setInterval(() => setTick((n) => n + 1), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  const refresh = useCallback(() => {
    setState((prev) => ({ ...prev, loading: true }));
    setTick((n) => n + 1);
  }, []);

  return { ...state, refresh };
}

export const useModels = () => useApi<ModelsResponse>("/api/models");
export const useStatus = (intervalMs?: number) => useApi<StatusResponse>("/api/status", intervalMs);
