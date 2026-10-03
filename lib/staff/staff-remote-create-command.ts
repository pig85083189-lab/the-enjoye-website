import { isValidStaffEmail, normalizeStaffEmail } from "@/lib/staff-auth/email";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";
import { newId } from "@/lib/repositories/storage";
import type { StaffRole } from "@/types/saas";
import { StaffRemoteCreateError } from "./staff-remote-create-errors";

export const STAFF_REMOTE_CREATE_MIN_PASSWORD_LENGTH = 8;

export const STAFF_REMOTE_CREATABLE_ROLES: StaffRole[] = [
  "MANAGER",
  "STAFF",
  "RECEPTIONIST",
  "ACCOUNTANT",
];

export type StaffRemoteCreateDraft = {
  displayName: string;
  email: string;
  password: string;
  role: string;
  locationIds: string[];
  isActive: boolean;
};

export type PreparedStaffRemoteCreate = {
  displayName: string;
  email: string;
  password: string;
  role: StaffRole;
  locationIds: string[];
  isActive: boolean;
  membershipId: string;
  userId: string;
};

export function isStaffRemoteCreatableRole(role: string): role is StaffRole {
  return STAFF_REMOTE_CREATABLE_ROLES.includes(role as StaffRole);
}

export function allocateStaffRemoteCreateIds(): {
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

export function prepareStaffRemoteCreateDraft(
  draft: StaffRemoteCreateDraft,
): PreparedStaffRemoteCreate {
  const displayName = draft.displayName.trim();
  if (!displayName) {
    throw new StaffRemoteCreateError("invalid_input", "請填寫員工姓名");
  }
  if (!isValidStaffEmail(draft.email)) {
    throw new StaffRemoteCreateError("invalid_input", "請輸入有效的登入 Email");
  }
  if (!draft.password || draft.password.length < STAFF_REMOTE_CREATE_MIN_PASSWORD_LENGTH) {
    throw new StaffRemoteCreateError(
      "invalid_input",
      `密碼至少需要 ${STAFF_REMOTE_CREATE_MIN_PASSWORD_LENGTH} 個字元`,
    );
  }
  if (draft.role === "OWNER") {
    throw new StaffRemoteCreateError("privilege_denied", "無法透過此表單建立店主");
  }
  if (!isStaffRemoteCreatableRole(draft.role)) {
    throw new StaffRemoteCreateError("invalid_input", "請選擇有效角色");
  }
  const locationIds = [...new Set(draft.locationIds.filter(Boolean))];
  if (locationIds.length === 0) {
    throw new StaffRemoteCreateError("invalid_input", "請至少選擇一間分店");
  }
  const ids = allocateStaffRemoteCreateIds();
  return {
    displayName,
    email: normalizeStaffEmail(draft.email),
    password: draft.password,
    role: draft.role,
    locationIds,
    isActive: draft.isActive !== false,
    ...ids,
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
