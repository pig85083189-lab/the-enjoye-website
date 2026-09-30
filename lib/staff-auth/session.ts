/**
 * In-memory Auth session pointer for the current tab.
 * Production identity comes from Supabase cookies, not localStorage.
 */

import { resetHydratedRemoteMembershipsForTests } from "@/lib/staff-auth/membership-query";

export interface StaffAuthUser {
  id: string;
  email: string | null;
}

const CHANGE = "beauty-os-staff-auth-change";

let liveUser: StaffAuthUser | null = null;
let testUser: StaffAuthUser | null = null;

function emit(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(CHANGE));
}

export function setStaffAuthUser(user: StaffAuthUser | null): void {
  liveUser = user;
  emit();
}

export function getStaffAuthUser(): StaffAuthUser | null {
  return testUser ?? liveUser;
}

export function getStaffAuthUserId(): string | null {
  return getStaffAuthUser()?.id ?? null;
}

export function subscribeStaffAuth(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(CHANGE, handler);
  return () => window.removeEventListener(CHANGE, handler);
}

export function getStaffAuthSnapshot(): string {
  const user = getStaffAuthUser();
  return user ? `${user.id}|${user.email ?? ""}` : "none";
}

/** Test-only: bind a fake auth user without touching production fallback staff-001. */
export function setStaffAuthUserForTests(user: StaffAuthUser | null): void {
  testUser = user;
  emit();
}

export function resetStaffAuthForTests(): void {
  testUser = null;
  liveUser = null;
  resetHydratedRemoteMembershipsForTests();
}

export function isDemoLocalStorageAuthEnabled(): boolean {
  return false;
}
