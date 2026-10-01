/**
 * Safe in-app next path after Staff Auth.
 * Never allow protocol-relative or off-staff URLs.
 */

export const DEFAULT_STAFF_NEXT_PATH = "/staff/today";

export function safeStaffNextPath(
  value: string | null | undefined,
  opts?: { allowAuthRoutes?: boolean },
): string {
  if (!value) return DEFAULT_STAFF_NEXT_PATH;
  if (!value.startsWith("/staff")) return DEFAULT_STAFF_NEXT_PATH;
  if (value.startsWith("//") || value.includes("://")) return DEFAULT_STAFF_NEXT_PATH;
  if (value.includes("\\") || value.includes("\n") || value.includes("\r")) {
    return DEFAULT_STAFF_NEXT_PATH;
  }
  if (value === "/staff/login" || value.startsWith("/staff/login?")) {
    return DEFAULT_STAFF_NEXT_PATH;
  }
  if (!opts?.allowAuthRoutes) {
    if (value === "/staff/auth" || value.startsWith("/staff/auth/")) {
      return DEFAULT_STAFF_NEXT_PATH;
    }
  }
  return value;
}
