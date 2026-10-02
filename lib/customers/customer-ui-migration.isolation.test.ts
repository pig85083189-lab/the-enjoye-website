import { describe, expect, it } from "vitest";
import { CUSTOMER_UI_MIGRATION_STEPS } from "./customer-ui-migration";

describe("Phase 1C-1 customer UI migration sequence", () => {
  it("documents A–E without switching live UI this round", () => {
    expect(CUSTOMER_UI_MIGRATION_STEPS.map((step) => step.id)).toEqual(["A", "B", "C", "D", "E"]);
    expect(CUSTOMER_UI_MIGRATION_STEPS[0]?.files).toContain("features/customers/CustomerListPage.tsx");
    expect(CUSTOMER_UI_MIGRATION_STEPS[4]?.files).toContain("features/calendar/CalendarPage.tsx");
    for (const step of CUSTOMER_UI_MIGRATION_STEPS) {
      expect(step.rollback.length).toBeGreaterThan(0);
      expect(step.remoteBehavior).not.toMatch(/seed fallback/i);
    }
  });
});
