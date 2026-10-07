/**
 * Staff onboarding use-case. Not a second store.
 * Membership writes go to createMembership; hours go to upsertWorkingHours.
 */
import * as staffSchedule from "@/lib/staff-schedule/store";
import {
  createMembership,
  listLocations,
  type CreateMembershipInput,
} from "@/lib/tenant/organization-store";
import type { StaffMembership } from "@/types/saas";
import {
  planOnboardingWorkingHours,
  validateOnboardingDraft,
  type StaffOnboardingDraft,
} from "./staff-onboarding-derived";

export interface CreateStaffOnboardingResult {
  membership: StaffMembership;
  scheduleError: string | null;
}

export function createStaffOnboarding(
  input: CreateMembershipInput,
  draft: StaffOnboardingDraft,
): CreateStaffOnboardingResult {
  const merged: StaffOnboardingDraft = {
    ...draft,
    displayName: input.displayName,
    role: input.role,
    locationIds: input.locationIds,
  };
  const invalid = validateOnboardingDraft(merged, listLocations(input.organizationId));
  if (invalid) throw new Error(invalid);

  const membership = createMembership(input);
  if (merged.scheduleMode === "later") {
    return { membership, scheduleError: null };
  }
  const payloads = planOnboardingWorkingHours({
    staffId: membership.userId,
    locationIds: membership.locationIds,
    hours: merged.hours,
  });
  try {
    for (const payload of payloads) {
      staffSchedule.upsertWorkingHours(membership.organizationId, payload);
    }
    return { membership, scheduleError: null };
  } catch (error) {
    return {
      membership,
      scheduleError:
        error instanceof Error ? error.message : "初始班表儲存失敗",
    };
  }
}

export function createStaffOnboardingFromDraft(
  organizationId: string,
  draft: StaffOnboardingDraft,
): CreateStaffOnboardingResult {
  return createStaffOnboarding(
    {
      organizationId,
      displayName: draft.displayName,
      role: draft.role,
      locationIds: draft.locationIds,
      email: draft.email || null,
      phone: draft.phone || null,
      title: draft.title || null,
    },
    draft,
  );
}
