/**
 * Phase 4.9C.1 — Staff entry (`/staff`) redirect resolution.
 * Pure helper only; no full Next.js routing framework.
 */
import { describe, expect, it } from "vitest";
import { resolveStaffEntryHref } from "@/lib/auth";

describe("resolveStaffEntryHref", () => {
  it("sends unauthenticated visitors to login", () => {
    expect(resolveStaffEntryHref(false)).toBe("/staff/login");
  });

  it("sends authenticated sessions to today", () => {
    expect(resolveStaffEntryHref(true)).toBe("/staff/today");
  });
});
