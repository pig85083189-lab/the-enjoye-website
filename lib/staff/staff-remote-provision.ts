/**
 * Owner Staff Auth + membership provisioning.
 * Service-role Auth Admin is a narrow server-only exception.
 * Password is sent only to the Auth create boundary and is never stored.
 */
import { MEMBERSHIP_ENJOYE_OWNER_ID } from "@/lib/tenant/constants";
import { assertNoPasswordField } from "@/lib/staff-auth/membership-schema";
import { assertOperationalStaffId, isAuthUuid } from "@/lib/staff-auth/staff-id";
import { normalizeStaffEmail } from "@/lib/staff-auth/email";
import type { StaffMembership, StaffRole } from "@/types/saas";
import {
  assertActorCanAssignLocations,
  prepareStaffRemoteCreateDraft,
  type StaffRemoteCreateDraft,
} from "./staff-remote-create-command";
import {
  redactStaffRemoteCreateSecret,
  StaffRemoteCreateError,
} from "./staff-remote-create-errors";

export type StaffRemoteCreateActor = {
  userId: string;
  organizationId: string;
  role: StaffRole;
  isActive: boolean;
  locationIds: string[];
};

export type StaffRemoteProvisionDeps = {
  createAuthUser: (email: string, password: string) => Promise<{ id: string }>;
  deleteAuthUser: (authUserId: string) => Promise<void>;
  persistMembership: (membership: StaffMembership) => Promise<StaffMembership>;
  deleteMembership: (membershipId: string) => Promise<void>;
  listOrgMemberships: (organizationId: string) => Promise<StaffMembership[]>;
  listOrgLocationIds: (organizationId: string) => Promise<string[]>;
};

export type StaffRemoteCreatePublicMembership = {
  id: string;
  userId: string;
  organizationId: string;
  role: StaffRole;
  displayName: string;
  email: string | null;
  locationIds: string[];
  isActive: boolean;
  authUserId: string;
  createdAt: string;
};

function publicMembership(row: StaffMembership): StaffRemoteCreatePublicMembership {
  assertNoPasswordField(row as unknown as Record<string, unknown>);
  assertOperationalStaffId(row.userId);
  if (!row.authUserId || !isAuthUuid(row.authUserId)) {
    throw new StaffRemoteCreateError("membership_failed", "員工登入對應不完整");
  }
  if (row.userId === row.authUserId) {
    throw new StaffRemoteCreateError("membership_failed", "Auth UUID 不得作為員工識別");
  }
  return {
    id: row.id,
    userId: row.userId,
    organizationId: row.organizationId,
    role: row.role,
    displayName: row.displayName,
    email: row.email ?? null,
    locationIds: [...row.locationIds],
    isActive: row.isActive,
    authUserId: row.authUserId,
    createdAt: row.createdAt,
  };
}

function assertOwnerActor(actor: StaffRemoteCreateActor): void {
  if (!actor.isActive || actor.role !== "OWNER") {
    throw new StaffRemoteCreateError("unauthorized", "沒有權限管理員工");
  }
  assertOperationalStaffId(actor.userId);
}

export async function provisionStaffEmployee(
  actor: StaffRemoteCreateActor,
  draft: StaffRemoteCreateDraft,
  deps: StaffRemoteProvisionDeps,
): Promise<StaffRemoteCreatePublicMembership> {
  assertOwnerActor(actor);
  const prepared = prepareStaffRemoteCreateDraft(draft);
  const orgLocationIds = await deps.listOrgLocationIds(actor.organizationId);
  assertActorCanAssignLocations(actor.locationIds, orgLocationIds, prepared.locationIds);

  const existing = await deps.listOrgMemberships(actor.organizationId);
  if (
    existing.some(
      (row) => row.email && normalizeStaffEmail(row.email) === prepared.email,
    )
  ) {
    throw new StaffRemoteCreateError("conflict", "無法使用這個 Email");
  }

  let authUserId: string | null = null;
  let membershipId: string | null = null;
  try {
    const created = await deps.createAuthUser(prepared.email, prepared.password);
    authUserId = created.id;
    if (!isAuthUuid(authUserId)) {
      throw new StaffRemoteCreateError("auth_failed", "無法建立登入帳號");
    }
    const now = new Date().toISOString();
    membershipId = prepared.membershipId;
    const persisted = await deps.persistMembership({
      id: prepared.membershipId,
      organizationId: actor.organizationId,
      userId: prepared.userId,
      locationIds: prepared.locationIds,
      role: prepared.role,
      displayName: prepared.displayName,
      isActive: prepared.isActive,
      createdAt: now,
      authUserId,
      email: prepared.email,
    });
    membershipId = persisted.id;
    if (membershipId === MEMBERSHIP_ENJOYE_OWNER_ID || persisted.userId === actor.userId) {
      throw new StaffRemoteCreateError("membership_failed", "不得覆寫現有店主");
    }
    return publicMembership(persisted);
  } catch (error) {
    const cleanup = await reconcilePartialStaffProvision({
      authUserId,
      membershipId,
      deleteAuthUser: deps.deleteAuthUser,
      deleteMembership: deps.deleteMembership,
    });
    if (error instanceof StaffRemoteCreateError) {
      if (cleanup.needed && !cleanup.succeeded) {
        throw new StaffRemoteCreateError(
          "partial_provisioning",
          "員工建立未完成，請聯絡系統管理員核對登入帳號",
          {
            authUserId: authUserId ?? undefined,
            membershipId: membershipId ?? undefined,
            cleanupAttempted: true,
            cleanupSucceeded: false,
          },
        );
      }
      throw error;
    }
    const message = redactStaffRemoteCreateSecret(
      error instanceof Error ? error.message : "員工建立失敗",
    );
    if (cleanup.needed && !cleanup.succeeded) {
      throw new StaffRemoteCreateError("partial_provisioning", message, {
        authUserId: authUserId ?? undefined,
        membershipId: membershipId ?? undefined,
        cleanupAttempted: true,
        cleanupSucceeded: false,
      });
    }
    throw new StaffRemoteCreateError(
      authUserId ? "membership_failed" : "auth_failed",
      message,
    );
  }
}

export async function reconcilePartialStaffProvision(input: {
  authUserId: string | null;
  membershipId: string | null;
  deleteAuthUser: (authUserId: string) => Promise<void>;
  deleteMembership: (membershipId: string) => Promise<void>;
}): Promise<{ needed: boolean; succeeded: boolean }> {
  if (!input.authUserId && !input.membershipId) {
    return { needed: false, succeeded: true };
  }
  let succeeded = true;
  if (input.membershipId && input.membershipId !== MEMBERSHIP_ENJOYE_OWNER_ID) {
    try {
      await input.deleteMembership(input.membershipId);
    } catch {
      succeeded = false;
    }
  }
  if (input.authUserId) {
    try {
      await input.deleteAuthUser(input.authUserId);
    } catch {
      succeeded = false;
    }
  }
  return { needed: true, succeeded };
}
