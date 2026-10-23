// @vitest-environment node
import { describe, expect, it } from "vitest";
import { annualBirthdayJobFingerprint, nextBirthdayYmd } from "@/lib/line/automations/schedule-fire-at";

describe("Phase 3 annual birthday identity (not yet wired to SQL)", () => {
  const identity = (occurrenceYmd: string) => annualBirthdayJobFingerprint({
    organizationId: "org-birthday", customerId: "customer-1",
    timingId: "birthday_morning", occurrenceYmd,
  });

  it("changes the fingerprint across birthday years", () => {
    expect(identity("2026-11-01")).not.toBe(identity("2027-11-01"));
  });

  it("is stable for repeated runs in the same year", () => {
    expect(identity("2026-11-01")).toBe(identity("2026-11-01"));
  });

  it("uses birthday occurrence year, not the advance-notice send year", () => {
    expect(identity("2027-01-01")).toContain("|2027");
  });

  it("keeps leap-day birthday within the same occurrence year", () => {
    expect(nextBirthdayYmd("2000-02-29", "2027-02-01")).toBe("2027-02-28");
    expect(identity("2027-02-28")).toContain("|2027");
  });

  it("rejects invalid occurrence dates", () => {
    expect(() => identity("2027-02-29")).toThrow("Invalid birthday occurrence");
  });
});
