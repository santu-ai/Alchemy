"use client";

import { useSyncExternalStore } from "react";

export interface StoreWriteOptions {
  /** 流式生成时先跳过落盘，结束时再 flush。 */
  persist?: boolean;
}

export interface LocalStore<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T), options?: StoreWriteOptions) => void;
  flush: () => boolean;
  subscribe: (listener: () => void) => () => void;
  serverSnapshot: () => T;
}

export function createLocalStore<T>(key: string, initial: T): LocalStore<T> {
  let cached: T | undefined;
  let persistTimer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const persist = () => {
    persistTimer = undefined;
    try {
      window.localStorage.setItem(key, JSON.stringify(cached));
      return true;
    } catch {
      return false;
    }
  };

  const read = (): T => {
    if (cached !== undefined) return cached;
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.localStorage.getItem(key);
      cached = raw ? (JSON.parse(raw) as T) : initial;
    } catch {
      cached = initial;
    }
    return cached;
  };

  const emit = () => listeners.forEach((listener) => listener());

  return {
    get: read,
    set(next, options) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(read()) : next;
      cached = value;
      if (options?.persist !== false) persistTimer ??= setTimeout(persist, 300);
      emit();
    },
    flush() {
      if (persistTimer) {
        clearTimeout(persistTimer);
        persistTimer = undefined;
      }
      return persist();
    },
    subscribe(listener) {
      listeners.add(listener);
      const onStorage = (event: StorageEvent) => {
        if (event.key !== key) return;
        cached = undefined;
        listener();
      };
      window.addEventListener("storage", onStorage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", onStorage);
      };
    },
    serverSnapshot: () => initial,
  };
}

export function useLocalStore<T>(store: LocalStore<T>) {
  return useSyncExternalStore(store.subscribe, store.get, store.serverSnapshot);
}

const noopSubscribe = () => () => {};

export function useHydrated() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}
