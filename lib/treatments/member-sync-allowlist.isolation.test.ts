import { describe, expect, it } from "vitest";
import { MEMBER_SYNC_ALLOWLIST_ENV, memberSyncCustomerAllowed } from "./member-sync-allowlist";

const listed = "22222222-2222-4222-8222-222222222222";
const other = "33333333-3333-4333-8333-333333333333";

describe("member sync customer allowlist", () => {
  it("allows nobody when the list is missing or empty", () => {
    expect(memberSyncCustomerAllowed(listed, {})).toBe(false);
    expect(memberSyncCustomerAllowed(listed, { [MEMBER_SYNC_ALLOWLIST_ENV]: "" })).toBe(false);
    expect(memberSyncCustomerAllowed(listed, { [MEMBER_SYNC_ALLOWLIST_ENV]: "not-a-uuid, staff-001" })).toBe(false);
  });

  it("allows only the listed booking customer", () => {
    const env = { [MEMBER_SYNC_ALLOWLIST_ENV]: ` ${listed.toUpperCase()} , not-a-uuid ` };
    expect(memberSyncCustomerAllowed(listed, env)).toBe(true);
    expect(memberSyncCustomerAllowed(other, env)).toBe(false);
    expect(memberSyncCustomerAllowed("", env)).toBe(false);
  });
});
