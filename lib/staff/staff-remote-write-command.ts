import { isValidStaffEmail, normalizeStaffEmail } from "@/lib/staff-auth/email";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";
import { newId } from "@/lib/repositories/storage";
import type { StaffRole } from "@/types/saas";
import { STAFF_REMOTE_CREATABLE_ROLES } from "./staff-remote-create-command";
import { StaffRemoteCreateError } from "./staff-remote-create-errors";

export { STAFF_REMOTE_CREATABLE_ROLES };

export type StaffOperationalCreateDraft = {
  organizationId?: string;
  displayName: string;
  phone?: string | null;
  email?: string | null;
  title?: string | null;
  role: string;
  locationIds: string[];
  membershipId?: string;
  userId?: string;
};

export type PreparedStaffOperationalCreate = {
  displayName: string;
  phone: string | null;
  email: string | null;
  title: string | null;
  role: StaffRole;
  locationIds: string[];
  membershipId: string;
  userId: string;
};

export function isStaffOperationalCreatableRole(role: string): role is StaffRole {
  return STAFF_REMOTE_CREATABLE_ROLES.includes(role as StaffRole);
}

export function allocateStaffOperationalCreateIds(): {
  membershipId: string;
  userId: string;
} {
  const membershipId = newId("mem");
  const userId = newId("staff");
  assertOperationalStaffId(userId);
  if (isAuthUuid(membershipId) || isAuthUuid(userId)) {
    throw new StaffRemoteCreateError("invalid_input", "無法配置員工識別");
  }
  return { membershipId, userId };
}

function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

export function prepareStaffOperationalCreateDraft(
  draft: StaffOperationalCreateDraft,
): PreparedStaffOperationalCreate {
  const displayName = draft.displayName.trim();
  if (!displayName) {
    throw new StaffRemoteCreateError("invalid_input", "請填寫員工姓名");
  }
  const email = optionalText(draft.email);
  if (email && !isValidStaffEmail(email)) {
    throw new StaffRemoteCreateError("invalid_input", "請輸入有效的 Email");
  }
  if (draft.role === "OWNER") {
    throw new StaffRemoteCreateError("privilege_denied", "無法透過此表單建立店主");
  }
  if (!isStaffOperationalCreatableRole(draft.role)) {
    throw new StaffRemoteCreateError("invalid_input", "請選擇有效角色");
  }
  const locationIds = [...new Set((draft.locationIds ?? []).filter(Boolean))];
  if (locationIds.length === 0) {
    throw new StaffRemoteCreateError("invalid_input", "請至少選擇一間分店");
  }
  if (locationIds.some((id) => isAuthUuid(id))) {
    throw new StaffRemoteCreateError("invalid_input", "分店不屬於目前店家或沒有權限");
  }
  const allocated = allocateStaffOperationalCreateIds();
  const membershipId = draft.membershipId?.trim() || allocated.membershipId;
  const userId = draft.userId?.trim() || allocated.userId;
  if (isAuthUuid(membershipId) || isAuthUuid(userId)) {
    throw new StaffRemoteCreateError("invalid_input", "Auth UUID 不得作為員工識別");
  }
  assertOperationalStaffId(userId);
  return {
    displayName,
    phone: optionalText(draft.phone),
    email: email ? normalizeStaffEmail(email) : null,
    title: optionalText(draft.title),
    role: draft.role,
    locationIds,
    membershipId,
    userId,
  };
}

export function assertActorCanAssignLocations(
  actorLocationIds: string[],
  orgLocationIds: string[],
  requestedLocationIds: string[],
): void {
  const org = new Set(orgLocationIds);
  const allowed = actorLocationIds.length > 0 ? new Set(actorLocationIds) : org;
  for (const locationId of requestedLocationIds) {
    if (!org.has(locationId) || !allowed.has(locationId)) {
      throw new StaffRemoteCreateError("invalid_input", "分店不屬於目前店家或沒有權限");
    }
  }
}
