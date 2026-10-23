// @vitest-environment node
import { describe, expect, it } from "vitest";
import { annualBirthdayJobFingerprint, birthdayOccurrenceYmdForFireAt, nextBirthdayYmd } from "@/lib/line/automations/schedule-fire-at";

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

  it.each([
    { organizationId: "other-org", customerId: "customer-1", timingId: "birthday_morning" },
    { organizationId: "org-a|birthday_greeting", customerId: "customer-1", timingId: "birthday_morning" },
    { organizationId: "org-a", customerId: "customer|1", timingId: "birthday_morning" },
    { organizationId: "org-a", customerId: "", timingId: "birthday_morning" },
    { organizationId: "org-a", customerId: "customer-1", timingId: "not-a-timing" },
  ])("rejects malformed identity components: %j", (components) => {
    expect(() => annualBirthdayJobFingerprint({
      ...components, occurrenceYmd: "2027-11-01",
    })).toThrow("Invalid birthday fingerprint input");
  });

  it("derives January birthday year from December advance reminder", () => {
    expect(birthdayOccurrenceYmdForFireAt({
      birthdayYmd: "1990-01-01",
      timingId: "days_before_3",
      fireAt: "2026-12-29T02:00:00.000Z",
    })).toBe("2027-01-01");
  });

  it("rejects send dates that do not correspond to the birthday", () => {
    expect(birthdayOccurrenceYmdForFireAt({
      birthdayYmd: "1990-01-01",
      timingId: "birthday_morning",
      fireAt: "2026-12-29T02:00:00.000Z",
    })).toBeNull();
  });

  it("resolves leap-day birthday observed on February 28 in non-leap years", () => {
    expect(birthdayOccurrenceYmdForFireAt({
      birthdayYmd: "2000-02-29",
      timingId: "birthday_morning",
      fireAt: "2027-02-28T02:00:00.000Z",
    })).toBe("2027-02-28");
  });

  it.each([
    "2027-01-01T03:00:00.000Z",
    "2027-01-01T02:00:30.000Z",
    "2027-01-01T02:00:00",
    "not-a-date",
  ])("rejects noncanonical birthday send timestamp %s", (fireAt) => {
    expect(birthdayOccurrenceYmdForFireAt({
      birthdayYmd: "1990-01-01",
      timingId: "birthday_morning",
      fireAt,
    })).toBeNull();
  });

  it("accepts a correctly offset Taipei morning timestamp", () => {
    expect(birthdayOccurrenceYmdForFireAt({
      birthdayYmd: "1990-01-01",
      timingId: "birthday_morning",
      fireAt: "2027-01-01T10:00:00+08:00",
    })).toBe("2027-01-01");
  });

  it("rejects invalid occurrence dates", () => {
    expect(() => identity("2027-02-29")).toThrow("Invalid birthday occurrence");
  });
});
