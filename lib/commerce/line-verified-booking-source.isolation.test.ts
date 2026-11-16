import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveBookingSourceFinanceCustomer } from "@/lib/commerce/booking-source-customer";
import { decideVerifiedLineSubject, lineMembershipIsCurrent } from "@/lib/commerce/line-verified-booking-source";
import { hashLineUserId } from "@/lib/line/line-bind";

const ROOT = process.cwd();
const HASH_A = "ab".repeat(32);
const HASH_B = "cd".repeat(32);

function trusted(hash: string) {
  return {
    source: "binding" as const,
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
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [
        { ...trusted(HASH_A), status: "unbound", verified: false, confirmedAt: null, boundAt: null, unboundAt: "2026-11-15T00:00:00Z" },
        { source: "member_link", hash: HASH_A, verified: true, status: "active", confirmedAt: "2026-11-16T00:00:00Z", boundAt: "2026-11-16T00:00:00Z", unboundAt: null, blockedAt: null },
      ],
    })).toEqual({ outcome: "review", reason: "LINE_REVOKED" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [
        { ...trusted(HASH_A), boundAt: "2026-11-14T00:00:00Z", confirmedAt: "2026-11-14T00:00:00Z" },
        { ...trusted(HASH_A), status: "unbound", verified: false, confirmedAt: null, boundAt: null, unboundAt: "2026-11-15T00:00:00Z" },
        { source: "member_link", hash: HASH_A, verified: true, status: "active", confirmedAt: "2026-11-16T00:00:00Z", boundAt: "2026-11-16T00:00:00Z", unboundAt: null, blockedAt: null },
      ],
    })).toEqual({ outcome: "review", reason: "LINE_REVOKED" });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [
        { ...trusted(HASH_A), status: "unbound", verified: false, confirmedAt: null, boundAt: null, unboundAt: "2026-11-15T00:00:00Z" },
        { source: "member_link", hash: HASH_A, verified: true, status: "active", confirmedAt: "2026-11-14T00:00:00Z", boundAt: "2026-11-14T00:00:00Z", unboundAt: null, blockedAt: null },
        trusted(HASH_B),
      ],
    })).toEqual({ outcome: "hash", hash: HASH_B });
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [
        { source: "member_link", hash: HASH_A, verified: true, status: "active", confirmedAt: "2026-11-16T00:00:00Z", boundAt: "2026-11-16T00:00:00Z", unboundAt: null, blockedAt: null },
      ],
    })).toEqual({ outcome: "hash", hash: HASH_A });
    expect(lineMembershipIsCurrent([], true)).toBe(true);
    expect(lineMembershipIsCurrent([
      { ...trusted(HASH_A), status: "unbound", verified: false, confirmedAt: null, boundAt: null, unboundAt: "2026-11-15T00:00:00Z" },
    ], true)).toBe(false);
    expect(lineMembershipIsCurrent([trusted(HASH_B)], false)).toBe(true);
    expect(decideVerifiedLineSubject({
      organizationAppId: "org-the-enjoye",
      customerOrganizationAppId: "org-the-enjoye",
      customerStatus: "ACTIVE",
      bindings: [{ ...trusted(HASH_A), status: "unbound", verified: false, confirmedAt: null, boundAt: null, unboundAt: null, blockedAt: null }],
    })).toEqual({ outcome: "review", reason: "LINE_REVOKED" });
    expect(lineMembershipIsCurrent([
      { ...trusted(HASH_A), status: "unbound", verified: false, confirmedAt: null, boundAt: null, unboundAt: "2026-11-15T00:00:00Z" },
      { source: "member_link", hash: HASH_B, verified: true, status: "active", confirmedAt: "2026-11-16T00:00:00Z", boundAt: "2026-11-16T00:00:00Z", unboundAt: null, blockedAt: null },
    ], true)).toBe(true);
  });

  it("uses the same trimmed SHA-256 subject hash as the member login source", () => {
    const subject = `U${"ab".repeat(16)}`;
    const digest = createHash("sha256").update(subject.trim(), "utf8").digest("hex");
    expect(hashLineUserId(`  ${subject}  `)).toBe(digest);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
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
      path.join(ROOT, "app/api/staff/stored-value/line-booking-source-link/route.ts"),
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
    const eligible = readFileSync(
      path.join(ROOT, "app/api/staff/stored-value/eligible-customers/route.ts"),
      "utf8",
    );
    expect(route).toMatch(/financeCustomerId/);
    expect(route).toMatch(/walletCustomerId/);
    expect(route).toMatch(/lineSubjectHash/);
    expect(route).toMatch(/getServerStaffAuthUser/);
    expect(route).toMatch(/not a\s+LINE OAuth callback/);
    expect(route).not.toMatch(/oauth\/callback/i);
    expect(route).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|cust-musfocyt-3x0fpe|cust-line-a6cd6d968c4747c39229bc1deb985559/);
    expect(migration).not.toMatch(/full_name|phone/);
    expect(migration).not.toMatch(/e06709d5-893f-4be1-8d83-b3d666a9257c|cust-musfocyt-3x0fpe/);
    expect(migration).toMatch(/LINE_VERIFIED_SESSION/);
    expect(migration).toMatch(/member_binding_requests/);
    expect(migration).toMatch(/active\.bound_at > revoked\.revoked_at/);
    expect(migration).toMatch(/customer_line_membership_is_current/);
    expect(migration).toMatch(/line_binding_resolved_customer_id/);
    expect(migration).toMatch(/line_customer_bindings\.organization_id is not text/);
    expect(migration).toMatch(/refusing to rewrite it/);
    expect(migration).toMatch(/refusing to replace constraints/);
    expect(migration).not.toMatch(/alter table public\.line_customer_bindings/i);
    expect(migration).not.toMatch(/alter table public\.organizations/i);
    expect(migration).not.toMatch(/update public\.stored_value_ledger_entries|delete from public\.stored_value_ledger_entries/i);
    expect(migration).not.toMatch(/drop policy/i);
    expect(migration).toMatch(/member_binding_requests is absent/);
    expect(migration).not.toMatch(/create or replace function public\.settle_checkout_draft/);
    expect(migration).not.toMatch(/drop table|truncate|delete from public\.member_/i);
    expect(migration).not.toMatch(/drop constraint[^;]*member_line_customer_links/i);
    expect(balance).toMatch(/line_subject_hash/);
    expect(balance).toMatch(/member_link/);
    expect(balance).not.toMatch(/linkVerifiedLineBookingSource/);
    expect(balance).not.toMatch(/POST/);
    expect(eligible).toMatch(/line_subject_hash/);
    expect(eligible).toMatch(/member_link/);
    expect(eligible).not.toMatch(/full_name ===|phone ===/);
  });
});
