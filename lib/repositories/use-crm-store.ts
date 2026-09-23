"use client";

import { useMemo, useSyncExternalStore } from "react";
import { subscribeCrmStore } from "./storage";

/** True only after client hydration — safe for localStorage-backed UI. */
export function useIsClient(): boolean {
  return useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
}

/**
 * Subscribe to CRM localStorage changes and parse a JSON snapshot.
 * `getSnapshot` must be pure (no localStorage writes).
 */
export function useCrmJson<T>(getSnapshot: () => T, serverFallback: T): T {
  const raw = useSyncExternalStore(
    subscribeCrmStore,
    () => JSON.stringify(getSnapshot()),
    () => JSON.stringify(serverFallback),
  );
  return useMemo(() => JSON.parse(raw) as T, [raw]);
}
