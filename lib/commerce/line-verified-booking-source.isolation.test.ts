import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBookingSourceFinanceCustomer } from "@/lib/commerce/booking-source-customer";
import { decideVerifiedLineSubject } from "@/lib/commerce/line-verified-booking-source";

const ROOT = process.cwd();
const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);

function trusted(hash: string) {
  return {
    hash,
    verified: true,
    status: "active",
    confirmedAt: "2026-11-16T00:00:00Z",
    boundAt: "2026-11-16T00:00:00Z",
    unboundAt: null,
    blockedAt: null,
  };
}

describe("verified LINE booking-source decision", () => {
  it("accepts one verified subject and ignores name or phone", () => {
    const source = readFileSync(path.join(ROOT, "lib/commerce/line-verified-booking-source.ts"), "utf8");
    expect(source).not.toMatch(/full_name|phone|birthday/);
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [trusted(HASH_A)],
    })).toEqual({ outcome: "hash", hash: HASH_A });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [trusted(HASH_A)],
    })).toEqual({ outcome: "hash", hash: HASH_A });
  });

  it("sends missing, revoked, disabled, conflicting, and cross-organization customers to review", () => {
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [],
    })).toEqual({ outcome: "review", reason: "NO_TRUSTED_ASSOCIATION" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [{ ...trusted(HASH_A), verified: false, confirmedAt: null, boundAt: null, status: "pending" }],
    })).toEqual({ outcome: "review", reason: "LINE_NOT_VERIFIED" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [{ ...trusted(HASH_A), status: "unbound", unboundAt: "2026-11-16T00:00:00Z" }],
    })).toEqual({ outcome: "review", reason: "LINE_REVOKED" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [trusted(HASH_A), trusted(HASH_B)],
    })).toEqual({ outcome: "review", reason: "MULTIPLE_LINE_SUBJECTS" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "INACTIVE",
      bindings: [trusted(HASH_A)],
    })).toEqual({ outcome: "review", reason: "ACCOUNT_DISABLED" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-other",
      customerStatus: "ACTIVE",
      bindings: [trusted(HASH_A)],
    })).toEqual({ outcome: "review", reason: "ORG_MISMATCH" });
  });

  it("lets a verified LINE link resolve a balance and leaves other evidence unchanged", () => {
    const organizationId = "11111111-1111-4111-8111-111111111111";
    expect(resolveBookingSourceFinanceCustomer({
      organizationId,
      sourceCustomerKey: "src-line-0001",
      links: [{
        organizationId,
        sourceCustomerKey: "src-line-0001",
        financeBookingCustomerId: "f44fffff-ffff-4fff-8fff-ffffffffffff",
        status: "ACTIVE",
        evidenceKind: "LINE_VERIFIED_SESSION",
      }],
    })).toBe("f44fffff-ffff-4fff-8fff-ffffffffffff");
    expect(resolveBookingSourceFinanceCustomer({
      organizationId,
      sourceCustomerKey: "src-review-0001",
      links: [],
    })).toBeNull();
  });

  it("does not accept a finance customer or the known production ids from the client", () => {
    const route = readFileSync(
      path.join(ROOT, "app/api/member/line/booking-source-link/route.ts"),
      "utf8",
    );
    const migration = readFileSync(
      path.join(ROOT, "supabase/migrations/20261116120000_line_verified_booking_source_link.sql"),
      "utf8",
    );
    const balance = readFileSync(
      path.join(ROOT, "app/api/staff/stored-value/balance/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/financeCustomerId/);
    expect(route).toMatch(/walletCustomerId/);
    expect(route).toMatch(/lineSubjectHash/);
    expect(route).toMatch(/getServerStaffAuthUser/);
    expect(route).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|cust-musfocyt-3x0fpe|cust-line-a6cd6d968c4747c39229bc1deb985559/);
    expect(migration).not.toMatch(/full_name|phone/);
    expect(migration).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|cust-musfocyt-3x0fpe/);
    expect(migration).toMatch(/LINE_VERIFIED_SESSION/);
    expect(migration).toMatch(/member_binding_requests/);
    expect(migration).not.toMatch(/create or replace function public\.settle_checkout_draft/);
    expect(balance).toMatch(/linkVerifiedLineBookingSource/);
  });
});
