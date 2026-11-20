/**
 * Deployment-wide allowlist for automatic member sync.
 * The remote read and write flags apply to the whole environment.
 * This list is a separate server check and defaults to nobody.
 */

export const MEMBER_SYNC_ALLOWLIST_ENV = "BEAUTY_OS_MEMBER_SYNC_CUSTOMER_ALLOWLIST";

const CUSTOMER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function memberSyncAllowlist(env: NodeJS.Dict<string> = process.env): ReadonlySet<string> {
  const raw = env[MEMBER_SYNC_ALLOWLIST_ENV] ?? "";
  const ids = raw.split(",").map((item) => item.trim().toLowerCase()).filter((item) => CUSTOMER_UUID.test(item));
  return new Set(ids);
}

/** True only when this booking customer UUID is explicitly listed. An empty list allows nobody. */
export function memberSyncCustomerAllowed(customerId: unknown, env: NodeJS.Dict<string> = process.env): boolean {
  if (typeof customerId !== "string" || !CUSTOMER_UUID.test(customerId.trim())) return false;
  return memberSyncAllowlist(env).has(customerId.trim().toLowerCase());
}
