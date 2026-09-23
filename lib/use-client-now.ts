"use client";

import { useSyncExternalStore } from "react";

/** Minute bucket so getSnapshot stays referentially stable within the same minute */
let clientMinute = -1;
const listeners = new Set<() => void>();

function notify() {
  const next = Math.floor(Date.now() / 60_000);
  if (next === clientMinute) return;
  clientMinute = next;
  listeners.forEach((listener) => listener());
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  const timeoutId = window.setTimeout(() => {
    clientMinute = Math.floor(Date.now() / 60_000);
    onStoreChange();
  }, 0);

  const intervalId = window.setInterval(notify, 30_000);

  return () => {
    listeners.delete(onStoreChange);
    window.clearTimeout(timeoutId);
    window.clearInterval(intervalId);
  };
}

function getSnapshot(): number {
  return clientMinute;
}

function getServerSnapshot(): number {
  return -1;
}

/**
 * Client-only clock for greeting / date labels.
 * Returns null during SSR / hydration to avoid mismatch.
 */
export function useClientNow(): Date | null {
  const minute = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  if (minute < 0) return null;
  return new Date(minute * 60_000);
}
