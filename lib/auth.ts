import type { Staff } from "@/types";
import { DEMO_STAFF } from "@/data/mock-staff";

export const AUTH_KEY = "enjoye-staff-auth";

export interface AuthSession {
  staffId: string;
  username: string;
  name: string;
  avatarInitials: string;
  remember: boolean;
}

export function validateCredentials(username: string, password: string): Staff | null {
  const normalized = username.trim().toLowerCase();
  if (normalized === DEMO_STAFF.username && password === DEMO_STAFF.password) {
    return DEMO_STAFF;
  }
  return null;
}

export function saveSession(staff: Staff, remember: boolean): void {
  if (typeof window === "undefined") return;
  const session: AuthSession = {
    staffId: staff.id,
    username: staff.username,
    name: staff.name,
    avatarInitials: staff.avatarInitials,
    remember,
  };
  localStorage.setItem(AUTH_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event("enjoye-auth-change"));
}

export function getSessionRaw(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(AUTH_KEY);
}

export function parseSession(raw: string | null): AuthSession | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export function getSession(): AuthSession | null {
  return parseSession(getSessionRaw());
}

export function clearSession(): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(AUTH_KEY);
  window.dispatchEvent(new Event("enjoye-auth-change"));
}

export function isAuthenticated(): boolean {
  return getSession() !== null;
}

/** Staff root entry (`/staff`) — same session signal as StaffShell (raw localStorage). */
export function resolveStaffEntryHref(
  sessionRaw: string | null,
): "/staff/login" | "/staff/today" {
  return sessionRaw === null ? "/staff/login" : "/staff/today";
}

export function subscribeAuth(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onStoreChange();
  window.addEventListener("storage", handler);
  window.addEventListener("enjoye-auth-change", handler);
  return () => {
    window.removeEventListener("storage", handler);
    window.removeEventListener("enjoye-auth-change", handler);
  };
}
