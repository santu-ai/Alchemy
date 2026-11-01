"use client";

import { useSyncExternalStore } from "react";

export interface LocalStore<T> {
  get: () => T;
  set: (next: T | ((prev: T) => T)) => void;
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
    } catch {}
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
    set(next) {
      const value = typeof next === "function" ? (next as (prev: T) => T)(read()) : next;
      cached = value;
      persistTimer ??= setTimeout(persist, 300);
      emit();
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
