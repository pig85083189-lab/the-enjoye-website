import { describe, expect, it } from "vitest";
import { verifiedBookingPublicationApprover } from "./publication-approver";

const session = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const organizationId = "org-enjoye";
const row = {
  auth_user_id: session,
  user_id: "staff-001",
  role: "STAFF",
  is_active: true,
  organization_id: organizationId,
};

describe("booking staff publication approver", () => {
  it("accepts the signed-in beautician without a manager review", () => {
    expect(verifiedBookingPublicationApprover({
      sessionUserId: session,
      membershipAuthUserId: session,
      membershipUserId: "staff-001",
      organizationId,
      rows: [row],
    })).toBe(session);
  });

  it("rejects a UUID that is not the booking session membership", () => {
    const other = "11111111-1111-4111-8111-111111111111";
    expect(verifiedBookingPublicationApprover({
      sessionUserId: other,
      membershipAuthUserId: session,
      membershipUserId: "staff-001",
      organizationId,
      rows: [row],
    })).toBeNull();
    expect(verifiedBookingPublicationApprover({
      sessionUserId: session,
      membershipAuthUserId: session,
      membershipUserId: "staff-001",
      organizationId,
      rows: [],
    })).toBeNull();
    expect(verifiedBookingPublicationApprover({
      sessionUserId: session,
      membershipAuthUserId: session,
      membershipUserId: "staff-001",
      organizationId,
      rows: [{ ...row, is_active: false }],
    })).toBeNull();
    expect(verifiedBookingPublicationApprover({
      sessionUserId: session,
      membershipAuthUserId: session,
      membershipUserId: session,
      organizationId,
      rows: [{ ...row, user_id: session }],
    })).toBeNull();
  });
});
