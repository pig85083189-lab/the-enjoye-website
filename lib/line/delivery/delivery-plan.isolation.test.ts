import { describe, expect, it } from "vitest";
import { planLineDelivery, type DeliveryCandidate } from "./delivery-plan";

const candidate: DeliveryCandidate = {
  kind: "automation",
  organizationId: "org-1",
  deliveryId: "appointment-1:24h",
  recipientId: "customer-1",
  message: "預約提醒",
  recipientVerified: true,
  recipientConsented: true,
  scheduledAtMs: 1000,
};

describe("LINE delivery planning remains fail-closed", () => {
  it.each(["automation", "broadcast"] as const)(
    "never sends or exposes recipient IDs for %s",
    (kind) => {
      const result = planLineDelivery(
        { ...candidate, kind },
        { nowMs: 2000, existingDeliveryKeys: new Set() },
      );
      expect(result).toEqual({
        decision: "blocked_send_closed",
        deliveryKey: null,
        sentLine: false,
      });
    },
  );

  it("does not let consent, verification, or timing override send gates", () => {
    const result = planLineDelivery(
      { ...candidate, scheduledAtMs: 0 },
      { nowMs: 999999, existingDeliveryKeys: new Set() },
    );
    expect(result.decision).toBe("blocked_send_closed");
    expect(result.sentLine).toBe(false);
  });
});
