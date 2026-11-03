import { describe, expect, it } from "vitest";
import {
  GUEST_UNVERIFIED_CALENDAR_LABEL,
  guestUnverifiedCalendarLabel,
} from "./domain";

describe("guest unverified calendar label", () => {
  it("labels an unverified guest booking as a new unverified customer", () => {
    expect(guestUnverifiedCalendarLabel("GUEST_UNVERIFIED")).toBe(
      GUEST_UNVERIFIED_CALENDAR_LABEL,
    );
    expect(GUEST_UNVERIFIED_CALENDAR_LABEL).toBe("新客／未驗證");
  });

  it("leaves ordinary appointments unlabeled", () => {
    expect(guestUnverifiedCalendarLabel("客人未到")).toBeNull();
    expect(guestUnverifiedCalendarLabel(null)).toBeNull();
    expect(guestUnverifiedCalendarLabel(undefined)).toBeNull();
  });
});
