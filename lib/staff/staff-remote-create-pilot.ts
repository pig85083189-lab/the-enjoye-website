/**
 * Authenticated Owner Staff remote create runner.
 * Do not import this module from Server Components that only need the flag.
 */
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import type { AuthenticatedStaffMembershipResult } from "@/lib/staff-auth/resolve-membership";
import { StaffRemoteCreateError } from "./staff-remote-create-errors";
import { isStaffRemoteCreatePilotEnabled } from "./staff-remote-create-flag";
import {
  provisionStaffEmployee,
  type StaffRemoteCreatePublicMembership,
  type StaffRemoteProvisionDeps,
} from "./staff-remote-provision";
import type { StaffRemoteCreateDraft } from "./staff-remote-create-command";

export async function runAuthenticatedStaffRemoteCreate(
  draft: StaffRemoteCreateDraft,
  deps: StaffRemoteProvisionDeps,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
  resolveActor: () => Promise<AuthenticatedStaffMembershipResult> = getAuthenticatedStaffMembership,
): Promise<StaffRemoteCreatePublicMembership> {
  if (!isStaffRemoteCreatePilotEnabled(env)) {
    throw new StaffRemoteCreateError("pilot_disabled", "遠端員工建立尚未啟用");
  }
  const resolved = await resolveActor();
  if (resolved.status === "unauthenticated") {
    throw new StaffRemoteCreateError("unauthenticated", "請先登入後再新增員工");
  }
  if (resolved.status !== "ok" || !resolved.membership) {
    throw new StaffRemoteCreateError("unauthorized", "沒有權限管理員工");
  }
  return provisionStaffEmployee(resolved.membership, draft, deps);
}
