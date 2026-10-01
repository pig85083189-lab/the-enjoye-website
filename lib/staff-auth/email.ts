export function normalizeStaffEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidStaffEmail(value: string): boolean {
  const email = normalizeStaffEmail(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
