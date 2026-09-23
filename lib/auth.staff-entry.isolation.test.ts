/**
 * Phase 4.9C.1 — Staff entry (`/staff`) redirect resolution.
 * Pure helper only; no full Next.js routing framework.
 */
import { describe, expect, it } from "vitest";
import { resolveStaffEntryHref } from "@/lib/auth";

describe("resolveStaffEntryHref", () => {
  it("sends unauthenticated visitors to login", () => {
    expect(resolveStaffEntryHref(null)).toBe("/staff/login");
  });

  it("sends authenticated sessions to today", () => {
    const raw = JSON.stringify({
      staffId: "staff-001",
      username: "yizhen",
      name: "怡蓁",
      avatarInitials: "怡",
      remember: true,
    });
    expect(resolveStaffEntryHref(raw)).toBe("/staff/today");
  });
});
