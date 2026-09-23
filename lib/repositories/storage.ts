import { CRM_CHANGE_EVENT, emitCrmChange } from "./keys";

export function readJson<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson<T>(key: string, value: T, eventDetail?: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(key, JSON.stringify(value));
  emitCrmChange(eventDetail ?? key);
}

export function subscribeCrmStore(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;

  const handler = () => onChange();
  window.addEventListener(CRM_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CRM_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
