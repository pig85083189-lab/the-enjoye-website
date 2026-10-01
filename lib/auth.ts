/**
 * Legacy demo helpers. Production staff auth is Supabase cookies, not localStorage.
 * Fake `enjoye-staff-auth` values cannot authenticate.
 */
import type { Staff } from "@/types";

export const AUTH_KEY = "enjoye-staff-auth";

export interface AuthSession {
  staffId: string;
  username: string;
  name: string;
  avatarInitials: string;
  remember: boolean;
}

/** Production login never accepts DEMO_STAFF credentials. */
export function validateCredentials(username: string, password: string): Staff | null {
  void username;
  void password;
  return null;
}

export function saveSession(staff: Staff, remember: boolean): void {
  void staff;
  void remember;
  // Production session lives in Supabase cookies. Do not persist passwords or fake sessions.
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
  return false;
}

/** Staff root entry (`/staff`) — cookie Auth, not localStorage. */
export function resolveStaffEntryHref(
  hasAuthUser: boolean,
): "/staff/login" | "/staff/today" {
  return hasAuthUser ? "/staff/today" : "/staff/login";
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
