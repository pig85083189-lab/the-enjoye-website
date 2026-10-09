import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_LUMIERE_STAFF_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  canShowStaffInviteControl,
  canShowStaffInviteRevokeControl,
  staffInviteBindingLabel,
} from "@/lib/staff-auth/staff-invite-visibility";
import {
  CREATE_STAFF_LOGIN_INVITE_RPC,
  evaluateStaffInviteBind,
  evaluateStaffInviteRequest,
  evaluateStaffInviteRevoke,
  interpretStaffInviteSendFailure,
  resolveUsableInvite,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import { STAFF_INVITE_SEND_OPEN } from "@/lib/staff-auth/staff-invite-flag";
import { pendingInviteMembershipIds } from "@/lib/staff-auth/staff-invite-state";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";
import { STAFF_REMOTE_CREATE_PILOT_ENV } from "@/lib/staff/staff-remote-create-flag";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";
const AUTH_INVITEE = "11111111-1111-4111-8111-111111111111";
const AUTH_OTHER = "22222222-2222-4222-8222-222222222222";
const MIGRATION_CREATE = "supabase/migrations/20261008130000_staff_login_invite_create.sql";
const YIXIN = {
  id: "mem-muy4glz6-yfvh84",
  organizationId: ORG_ENJOYE_ID,
  userId: "staff-muy4glz6-0g09f4",
  email: "vicky03070510@gmail.com",
  isActive: true,
  authUserId: null,
} satisfies StaffInviteTarget;

function source(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function ownerActor(over: Partial<StaffInviteActor> = {}): StaffInviteActor {
  return {
    authUserId: AUTH_OWNER,
    role: "OWNER",
    isActive: true,
    organizationId: ORG_ENJOYE_ID,
    userId: "staff-001",
    ...over,
  };
}

function pendingInvite(over: Partial<StaffInviteRecord> = {}): StaffInviteRecord {
  return {
    id: "inv-yixin-canary",
    membershipId: YIXIN.id,
    organizationId: ORG_ENJOYE_ID,
    email: YIXIN.email!,
    invitedAuthUserId: AUTH_INVITEE,
    status: "pending",
    expiresAt: "2099-01-01T00:00:00.000Z",
    ...over,
  };
}

function request(
  over: Partial<Parameters<typeof evaluateStaffInviteRequest>[0]> = {},
) {
  return evaluateStaffInviteRequest({
    invitePilotEnabled: true,
    inviteSendOpen: false,
    organizationId: ORG_ENJOYE_ID,
    membershipId: YIXIN.id,
    email: YIXIN.email,
    actor: ownerActor(),
    target: YIXIN,
    ...over,
  });
}

describe("2B-2 invite states: pending / accepted / revoked / expired", () => {
  it("retries a same-membership pending invite as resend instead of a second row", () => {
    expect(
      request({
        inviteSendOpen: true,
        existingInvite: pendingInvite(),
      }),
    ).toEqual({ ok: true, email: YIXIN.email, mode: "resend" });
    expect(
      request({
        inviteSendOpen: true,
        existingInvite: pendingInvite({ email: "other@example.com" }),
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("allows resend only for a pending unexpired invite", () => {
    const ok = request({
      inviteSendOpen: true,
      mode: "resend",
      existingInvite: pendingInvite(),
    });
    expect(ok).toEqual({ ok: true, email: YIXIN.email, mode: "resend" });
    expect(
      request({
        inviteSendOpen: true,
        mode: "resend",
        existingInvite: pendingInvite({ status: "revoked" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
    expect(
      request({
        inviteSendOpen: true,
        mode: "resend",
        existingInvite: pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
  });

  it("treats expired pending rows as expired and allows a new invite", () => {
    expect(
      resolveUsableInvite(pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }))
        ?.status,
    ).toBe("expired");
    expect(
      request({
        inviteSendOpen: true,
        existingInvite: pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      }),
    ).toEqual({ ok: true, email: YIXIN.email, mode: "invite" });
    expect(
      request({
        inviteSendOpen: true,
        existingInvite: pendingInvite({ status: "revoked" }),
      }),
    ).toEqual({ ok: true, email: YIXIN.email, mode: "invite" });
  });

  it("refuses accepted invites and already-bound memberships", () => {
    expect(
      request({
        inviteSendOpen: true,
        existingInvite: pendingInvite({ status: "accepted" }),
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      request({
        inviteSendOpen: true,
        target: { ...YIXIN, authUserId: AUTH_OTHER },
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("maps email send failures without leaking tokens", () => {
    expect(interpretStaffInviteSendFailure("User already registered")).toEqual({
      reason: "conflict",
      message: "這個 Email 已經有登入帳號",
    });
    expect(interpretStaffInviteSendFailure("SMTP timeout")).toEqual({
      reason: "error",
      message: "邀請信寄送失敗",
    });
    expect(interpretStaffInviteSendFailure("invalid email")).toMatchObject({
      reason: "invalid_email",
    });
    expect(source("lib/staff-auth/staff-invite-send-adapter.ts")).not.toMatch(
      /console\.(log|info|debug|error)/,
    );
    expect(source("lib/staff-auth/actions.ts")).not.toMatch(/invite_token|hashed_token/);
    expect(source("lib/staff-auth/staff-invite-send-adapter.ts")).not.toMatch(
      /invite_token|hashed_token|console\.(log|info|debug)/,
    );
  });
});

describe("2B-2 revoke, existing Auth, cross-org, and STAFF escalation", () => {
  it("lets only an active Owner revoke a pending invite", () => {
    expect(
      evaluateStaffInviteRevoke({
        invitePilotEnabled: true,
        actor: ownerActor(),
        invite: pendingInvite(),
      }),
    ).toEqual({ ok: true, inviteId: "inv-yixin-canary" });
    expect(
      evaluateStaffInviteRevoke({
        invitePilotEnabled: true,
        actor: ownerActor({ role: "STAFF" }),
        invite: pendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteRevoke({
        invitePilotEnabled: true,
        actor: ownerActor({ organizationId: ORG_LUMIERE_ID }),
        invite: pendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteRevoke({
        invitePilotEnabled: true,
        actor: ownerActor(),
        invite: pendingInvite({ status: "accepted" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
  });

  it("refuses existing Auth users, cross-org invite, and STAFF", () => {
    expect(
      request({
        inviteSendOpen: true,
        existingAuthUserIdForEmail: AUTH_OTHER,
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      request({
        inviteSendOpen: true,
        organizationId: ORG_LUMIERE_ID,
        actor: ownerActor({ organizationId: ORG_LUMIERE_ID }),
        target: YIXIN,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      request({
        inviteSendOpen: true,
        actor: ownerActor({ role: "STAFF" }),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      request({
        inviteSendOpen: true,
        existingInvite: pendingInvite({ membershipId: MEMBERSHIP_LUMIERE_STAFF_ID }),
        mode: "resend",
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  it("accepts only the invited auth user and ignores client membership IDs", () => {
    const ok = evaluateStaffInviteBind({
      invite: pendingInvite(),
      membership: YIXIN,
      actorAuthUserId: AUTH_INVITEE,
      actorEmail: YIXIN.email,
    });
    expect(ok).toMatchObject({
      ok: true,
      inviteId: "inv-yixin-canary",
      membershipId: YIXIN.id,
    });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite(),
        membership: { ...YIXIN, id: "mem-client-forged" },
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
    const accept = source("lib/staff-auth/actions.ts");
    expect(accept).toMatch(/export async function acceptStaffInviteAction/);
    expect(accept).toMatch(/loadPendingStaffInviteForAuthUser/);
    expect(accept).not.toMatch(/acceptStaffInviteAction\(input/);
    expect(accept).not.toMatch(/user_metadata/);
  });
});

describe("2B-2 Owner invite UI stays hidden by default", () => {
  it("shows the send control for Owner-eligible staff and never for STAFF", () => {
    const eligible = {
      membershipId: YIXIN.id,
      organizationId: ORG_ENJOYE_ID,
      userId: YIXIN.userId,
      email: YIXIN.email,
      isActive: true,
      authUserId: null,
    };
    expect(
      canShowStaffInviteControl({
        invitePilotEnabled: false,
        inviteSendOpen: false,
        actorRole: "OWNER",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        target: eligible,
      }),
    ).toBe(true);
    expect(
      canShowStaffInviteControl({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        actorRole: "OWNER",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        target: eligible,
      }),
    ).toBe(true);
    expect(
      canShowStaffInviteControl({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        actorRole: "STAFF",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        target: eligible,
      }),
    ).toBe(false);
    expect(
      canShowStaffInviteControl({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        actorRole: "MANAGER",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        target: eligible,
      }),
    ).toBe(false);
    expect(
      canShowStaffInviteControl({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        actorRole: "OWNER",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        target: eligible,
      }),
    ).toBe(true);
    expect(
      canShowStaffInviteRevokeControl({
        invitePilotEnabled: true,
        actorRole: "OWNER",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        invite: pendingInvite(),
      }),
    ).toBe(true);
    expect(staffInviteBindingLabel("pending")).toBe("等待啟用");
    expect(
      pendingInviteMembershipIds([pendingInvite(), pendingInvite({ status: "revoked" })]),
    ).toEqual([YIXIN.id]);
  });
});

describe("2B-2 source contracts", () => {
  it("keeps send closed and puts inviteUserByEmail only in the server adapter", () => {
    expect(STAFF_INVITE_SEND_OPEN).toBe(false);
    const actions = source("lib/staff-auth/actions.ts");
    expect(actions).toMatch(/deliverStaffLoginInvite/);
    expect(actions).toMatch(/invite_send_closed/);
    expect(actions).not.toMatch(/inviteUserByEmail/);
    expect(actions).not.toMatch(/admin\.createUser/);
    expect(actions).not.toMatch(/bindServerStaffMembershipAuthUser/);
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/inviteUserByEmail/);
    expect(adapter).toMatch(/isStaffInviteSendOpen/);
    expect(adapter).toMatch(/evaluateStaffInviteCanarySend/);
    expect(adapter).toMatch(/CREATE_STAFF_LOGIN_INVITE_RPC/);
    expect(adapter).not.toMatch(/bind_invited_staff_auth_user/);
    expect(adapter).not.toMatch(/createUser/);
    expect(adapter).not.toMatch(/generateLink/);
    expect(adapter).not.toMatch(/resetPasswordForEmail/);
  });

  it("keeps password setup from entering the workspace before bind", () => {
    const setup = source("app/staff/auth/setup-password/page.tsx");
    expect(setup).toMatch(/completeStaffPasswordSetupAction/);
    expect(setup).toMatch(/updateUser\(\{\s*password/);
    expect(setup.indexOf("completeStaffPasswordSetupAction")).toBeLessThan(
      setup.lastIndexOf("/staff/today"),
    );
    expect(setup).toMatch(/尚未取得工作台權限/);
    const callback = source("app/staff/auth/callback/route.ts");
    expect(callback).toMatch(/loadStaffSessionGate/);
    expect(callback).toMatch(/resolveStaffAuthCallbackNext/);
    expect(callback).not.toMatch(/membershipId/);
    expect(callback).not.toMatch(/user_metadata/);
    const actions = source("lib/staff-auth/actions.ts");
    expect(actions).toMatch(/export async function completeStaffPasswordSetupAction/);
    expect(actions).toMatch(/evaluateStaffPasswordSetup/);
    expect(actions).toMatch(/intent === "recovery"/);
    expect(
      actions.indexOf("if (intent === \"recovery\")"),
    ).toBeLessThan(actions.lastIndexOf("acceptStaffInviteAction()"));
  });

  it("renders an explicit STAFF deny panel instead of a blank shell", () => {
    expect(source("features/staff/StaffRoleDeniedPanel.tsx")).toMatch(
      /data-staff-role-denied/,
    );
    expect(source("lib/staff/StaffRolePageLayout.tsx")).toMatch(
      /access === "forbidden"/,
    );
    expect(source("app/staff/(app)/staff/page.tsx")).toMatch(/StaffRoleDeniedPanel/);
    expect(source("app/staff/(app)/settings/layout.tsx")).toMatch(
      /StaffRolePageLayout/,
    );
    expect(source("features/staff/StaffInvitePanel.tsx")).toMatch(
      /canShowStaffInviteControl/,
    );
    expect(source("features/staff/StaffQuickView.tsx")).toMatch(/StaffInvitePanel/);
  });

  it("keeps the create-invite migration additive and closed to table writes", () => {
    expect(existsSync(path.join(ROOT, MIGRATION_CREATE))).toBe(true);
    const sql = source(MIGRATION_CREATE);
    expect(sql).toMatch(
      new RegExp(`create or replace function public\\.${CREATE_STAFF_LOGIN_INVITE_RPC}`),
    );
    expect(sql).toMatch(/security definer/);
    expect(sql).not.toMatch(/security invoker/);
    expect(sql).toMatch(/role = 'OWNER'/);
    expect(sql).toMatch(/Does not create Staff/);
    expect(sql).not.toMatch(/set auth_user_id/);
    expect(sql).not.toMatch(/update public\.staff_auth_memberships/);
    expect(sql).not.toMatch(/grant update \(auth_user_id\)/);
    expect(sql).not.toMatch(/grant insert on public\.staff_login_invites/);
    expect(sql).not.toMatch(/create_operational_staff/);
    expect(sql).not.toMatch(/inviteUserByEmail/);
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STAFF_REMOTE_CREATE_PILOT_ENV).toBe("BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT");
    expect(APPOINTMENT_REMOTE_MUTATE_PILOT_ENV).toBe(
      "BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT",
    );
    expect(source("lib/staff/staff-write-guard.ts")).toMatch(/遠端班表尚未開放/);
  });
});
