/** Employee login IDs are independent of display names and email addresses. */
export const STAFF_USERNAME_PATTERN = /^[a-z][a-z0-9._-]{2,31}$/;

export function normalizeStaffUsername(value: string): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return STAFF_USERNAME_PATTERN.test(normalized) ? normalized : null;
}

/** Reserved names must never be assigned to a staff identity. */
const RESERVED = new Set(["admin", "owner", "root", "system", "support", "login", "staff", "api"]);
export function validateStaffUsername(value: string): string | null {
  const normalized = normalizeStaffUsername(value);
  return normalized && !RESERVED.has(normalized) ? normalized : null;
}
