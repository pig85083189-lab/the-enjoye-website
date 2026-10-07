import { canCreateOperationalStaff } from "@/lib/staff-auth/operational-capabilities";
import type { StaffRole } from "@/types/saas";

export const STAFF_CREATE_FAILURE_MESSAGE =
  "員工建立失敗，資料尚未儲存，請稍後再試。";

export type StaffOnboardingSubmitPath =
  | "write"
  | "create-auth"
  | "locked"
  | "forbidden-local"
  | "local";

export function canSubmitStaffOnboarding(role: StaffRole | undefined): boolean {
  return canCreateOperationalStaff({ role, isActive: true });
}

export function resolveStaffOnboardingSubmitPath(input: {
  remoteWriteEnabled: boolean;
  remoteCreateEnabled: boolean;
  remoteRosterLocked: boolean;
}): StaffOnboardingSubmitPath {
  if (input.remoteWriteEnabled) return "write";
  if (input.remoteRosterLocked && !input.remoteCreateEnabled) return "locked";
  if (input.remoteCreateEnabled) return "create-auth";
  if (input.remoteRosterLocked) return "forbidden-local";
  return "local";
}

export function shouldExposeStaffCreateDiagnostic(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  return env.VERCEL_ENV !== "production";
}

export function formatStaffCreateFailureUi(
  error: unknown,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): { message: string; diagnostic: string | null } {
  const diagnostic = error instanceof Error ? error.message : String(error);
  return {
    message: STAFF_CREATE_FAILURE_MESSAGE,
    diagnostic: shouldExposeStaffCreateDiagnostic(env) ? diagnostic : null,
  };
}

export function isCanonicalStaffCreateSuccess(input: {
  membershipId?: string | null;
  userId?: string | null;
  authUserId?: string | null;
  locationIds?: string[] | null;
}): boolean {
  return Boolean(
    input.membershipId &&
      input.userId &&
      input.userId.startsWith("staff-") &&
      !input.authUserId &&
      (input.locationIds?.length ?? 0) > 0,
  );
}

export function resolveStaffCreateLocations<T extends { id: string }>(input: {
  submitPath: StaffOnboardingSubmitPath;
  locations: T[];
  remoteLocationIds: string[];
}): T[] {
  if (input.submitPath !== "write") return input.locations;
  const allowed = new Set(input.remoteLocationIds.filter(Boolean));
  const filtered = input.locations.filter((location) => allowed.has(location.id));
  if (filtered.length > 0) return filtered;
  return input.locations.filter((location) => location.id === "loc-enjoye-main");
}

export function sanitizeStaffCreateLocationIds(
  requested: string[],
  allowed: string[],
): string[] {
  const allow = new Set(allowed.filter(Boolean));
  return [...new Set(requested.filter((id) => allow.has(id)))];
}
