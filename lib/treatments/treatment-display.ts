/**
 * Live Treatment display resolution.
 * Identity stays on canonical ids. Labels come from catalogs / roster.
 * Never show raw svc-* / staff-* / cust-* as a human name.
 */

export function isRawServiceId(value: string | undefined | null): boolean {
  return Boolean(value && /^svc-[a-z0-9-]+$/i.test(value.trim()));
}

export function isRawStaffId(value: string | undefined | null): boolean {
  return Boolean(value && /^staff-[a-z0-9-]+$/i.test(value.trim()));
}

export function isRawCustomerId(value: string | undefined | null): boolean {
  return Boolean(value && /^cust-[a-z0-9-]+$/i.test(value.trim()));
}

export function resolveCanonicalServiceDisplayName(input: {
  serviceId: string;
  catalogName?: string | null;
  snapshotName?: string | null;
}): string {
  const catalog = input.catalogName?.trim();
  if (catalog && !isRawServiceId(catalog)) return catalog;
  const snapshot = input.snapshotName?.trim();
  if (snapshot && !isRawServiceId(snapshot)) return snapshot;
  return "療程";
}

export function resolveCanonicalStaffDisplayName(input: {
  staffId: string;
  rosterName?: string | null;
  snapshotName?: string | null;
}): string {
  const roster = input.rosterName?.trim();
  if (roster && !isRawStaffId(roster)) return roster;
  const snapshot = input.snapshotName?.trim();
  if (snapshot && !isRawStaffId(snapshot)) return snapshot;
  return "—";
}

export function resolveCanonicalCustomerDisplayName(input: {
  customerId: string;
  catalogName?: string | null;
  snapshotName?: string | null;
}): string {
  const catalog = input.catalogName?.trim();
  if (catalog && !isRawCustomerId(catalog)) return catalog;
  const snapshot = input.snapshotName?.trim();
  if (snapshot && !isRawCustomerId(snapshot)) return snapshot;
  return "客戶";
}
