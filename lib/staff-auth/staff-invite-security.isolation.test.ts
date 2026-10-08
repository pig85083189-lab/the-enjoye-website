import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_LUMIERE_STAFF_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { canMembershipManageStaff } from "@/lib/staff-auth/actors";
import { getStaffInviteCapability } from "@/lib/staff-auth/invite-capability";
import {
  BIND_INVITED_STAFF_AUTH_USER_RPC,
  evaluateStaffInviteBind,
  evaluateStaffInviteRequest,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import {
  isStaffInvitePilotEnabled,
  isStaffInviteSendOpen,
  STAFF_INVITE_PILOT_ENV,
  STAFF_INVITE_SEND_OPEN,
} from "@/lib/staff-auth/staff-invite-flag";
import {
  resolveStaffSessionGate,
  resolveStaffSessionRedirect,
  STAFF_ACCESS_UNAVAILABLE_HREF,
  STAFF_SETUP_PASSWORD_HREF,
  STAFF_TODAY_HREF,
} from "@/lib/staff-auth/staff-invite-gate";
import {
  assertInviteRedirectIsolated,
  isPreviewSupabaseUrl,
  isProductionStaffOrigin,
  isProductionSupabaseUrl,
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_SUPABASE_HOST,
  resolveStaffInviteRedirect,
} from "@/lib/staff-auth/staff-invite-redirect";
import { transitionStaffInviteStatus } from "@/lib/staff-auth/staff-invite-state";
import {
  resolveStaffRolePageAccess,
  STAFF_FINANCE_ROLES,
  STAFF_SETTINGS_ROLES,
} from "@/lib/staff/staff-role-page-access";
import { STAFF_REMOTE_CREATE_PILOT_ENV } from "@/lib/staff/staff-remote-create-flag";
import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";
import { STORED_VALUE_WRITE_OPEN } from "@/lib/commerce/transaction-tender-presentation";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";
const AUTH_INVITEE = "11111111-1111-4111-8111-111111111111";
const AUTH_OTHER = "22222222-2222-4222-8222-222222222222";
const MIGRATION = "supabase/migrations/20261008120000_staff_login_invite_foundation.sql";
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

function request(over: Partial<Parameters<typeof evaluateStaffInviteRequest>[0]> = {}) {
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

describe("Staff invite 2B-1 flag and fail-closed action", () => {
  it("defaults the invite pilot and send path off", () => {
    expect(STAFF_INVITE_PILOT_ENV).toBe("BEAUTY_OS_STAFF_INVITE_PILOT");
    expect(STAFF_INVITE_SEND_OPEN).toBe(false);
    expect(isStaffInvitePilotEnabled({})).toBe(false);
    expect(isStaffInvitePilotEnabled({ [STAFF_INVITE_PILOT_ENV]: "1" })).toBe(false);
    expect(
      isStaffInvitePilotEnabled({
        [STAFF_INVITE_PILOT_ENV]: "1",
        NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toBe(true);
    expect(
      isStaffInviteSendOpen({
        [STAFF_INVITE_PILOT_ENV]: "1",
        NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test",
      }),
    ).toBe(false);
    expect(getStaffInviteCapability().configured).toBe(false);
    expect(
      getStaffInviteCapability({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        serviceRoleKey: "service-role",
      }).configured,
    ).toBe(false);
  });

  it("refuses a direct action call when the flag is off even if the actor is Owner", () => {
    const decision = request({ invitePilotEnabled: false, inviteSendOpen: true });
    expect(decision).toMatchObject({ ok: false, reason: "pilot_disabled" });
  });

  it("cannot omit organizationId or membershipId to bypass authorization", () => {
    expect(request({ organizationId: null })).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
    expect(request({ membershipId: undefined })).toMatchObject({
      ok: false,
      reason: "unauthorized",
    });
  });

  it("refuses STAFF and MANAGER invite attempts", () => {
    expect(
      request({
        actor: ownerActor({ role: "STAFF" }),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      request({
        actor: ownerActor({ role: "MANAGER" }),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(canMembershipManageStaff({ role: "MANAGER", isActive: true })).toBe(false);
    expect(canMembershipManageStaff({ role: "OWNER", isActive: true })).toBe(true);
  });

  it("refuses cross-organization invite and email mismatch", () => {
    expect(
      request({
        organizationId: ORG_LUMIERE_ID,
        target: { ...YIXIN, organizationId: ORG_ENJOYE_ID },
        actor: ownerActor({ organizationId: ORG_LUMIERE_ID }),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(request({ email: "other@example.com" })).toMatchObject({
      ok: false,
      reason: "invalid_email",
    });
    expect(request({ existingAuthUserIdForEmail: AUTH_OTHER })).toMatchObject({
      ok: false,
      reason: "conflict",
    });
    expect(request({ target: { ...YIXIN, authUserId: AUTH_OTHER } })).toMatchObject({
      ok: false,
      reason: "conflict",
    });
  });

  it("still refuses send after a valid Owner security check", () => {
    expect(request({ inviteSendOpen: false })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
  });

  it("ignores client redirectTo and isolates Preview from Production", () => {
    const production = resolveStaffInviteRedirect(
      {
        NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
      },
      "https://evil.example/steal",
    );
    expect(production).toMatchObject({
      ok: true,
      origin: PRODUCTION_STAFF_ORIGIN,
    });
    if (production.ok) {
      expect(production.redirectTo).toContain("/staff/auth/callback?next=/staff/auth/setup-password");
      expect(production.redirectTo).not.toContain("evil.example");
    }

    const leaked = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "production",
      VERCEL_URL: "the-enjoye-website.vercel.app",
    });
    expect(leaked.ok).toBe(false);
    if (!leaked.ok) expect(leaked.reason).toBe("cross_environment");

    const preview = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "preview",
      VERCEL_URL: "the-enjoye-website-preview-1.vercel.app",
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(isProductionStaffOrigin(preview.origin)).toBe(false);
      expect(preview.origin).not.toBe(PRODUCTION_STAFF_ORIGIN);
    }

    expect(
      assertInviteRedirectIsolated({
        supabaseUrl: `https://${PRODUCTION_SUPABASE_HOST}`,
        origin: PRODUCTION_STAFF_ORIGIN,
      }),
    ).toBe(true);
    expect(
      assertInviteRedirectIsolated({
        supabaseUrl: `https://${PREVIEW_SUPABASE_HOST}`,
        origin: PRODUCTION_STAFF_ORIGIN,
      }),
    ).toBe(false);
    expect(isProductionSupabaseUrl(`https://${PRODUCTION_SUPABASE_HOST}`)).toBe(true);
    expect(isPreviewSupabaseUrl(`https://${PREVIEW_SUPABASE_HOST}`)).toBe(true);
  });
});

describe("Staff invite state machine and late bind", () => {
  it("accepts only a pending unexpired invite", () => {
    expect(
      transitionStaffInviteStatus({
        status: "pending",
        event: "accept",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }),
    ).toEqual({ ok: true, status: "accepted" });
    expect(
      transitionStaffInviteStatus({
        status: "revoked",
        event: "accept",
        expiresAt: "2099-01-01T00:00:00.000Z",
      }).ok,
    ).toBe(false);
    expect(
      transitionStaffInviteStatus({
        status: "pending",
        event: "accept",
        expiresAt: "2020-01-01T00:00:00.000Z",
      }),
    ).toMatchObject({ ok: false, reason: "expired" });
  });

  it("binds only the invited auth user to the existing membership", () => {
    const ok = evaluateStaffInviteBind({
      invite: pendingInvite(),
      membership: YIXIN,
      actorAuthUserId: AUTH_INVITEE,
      actorEmail: YIXIN.email,
    });
    expect(ok).toEqual({
      ok: true,
      membershipId: YIXIN.id,
      authUserId: AUTH_INVITEE,
    });
  });

  it("refuses claim by email only, metadata-like mismatch, replay, and cross org", () => {
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ invitedAuthUserId: AUTH_OTHER }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ email: "other@example.com" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: "other@example.com",
      }),
    ).toMatchObject({ ok: false, reason: "invalid_email" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ status: "revoked" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite(),
        membership: { ...YIXIN, authUserId: AUTH_OTHER },
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ organizationId: ORG_LUMIERE_ID }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ membershipId: MEMBERSHIP_LUMIERE_STAFF_ID }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: YIXIN.email,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
  });
});

describe("Unbound session and role page gates", () => {
  it("sends pending invited users to setup-password instead of the workspace", () => {
    expect(
      resolveStaffSessionGate({
        authenticated: true,
        boundActiveMembership: false,
        pendingInviteForAuthUser: true,
      }),
    ).toBe("setup_password");
    expect(
      resolveStaffSessionRedirect({
        pathname: "/staff/today",
        gate: "setup_password",
      }),
    ).toBe(STAFF_SETUP_PASSWORD_HREF);
    expect(
      resolveStaffSessionRedirect({
        pathname: "/staff/login",
        gate: "setup_password",
      }),
    ).toBe(STAFF_SETUP_PASSWORD_HREF);
    expect(
      resolveStaffSessionRedirect({
        pathname: STAFF_SETUP_PASSWORD_HREF,
        gate: "setup_password",
      }),
    ).toBeNull();
  });

  it("keeps unbound users out of the workspace", () => {
    expect(
      resolveStaffSessionRedirect({
        pathname: "/staff/today",
        gate: "access_unavailable",
      }),
    ).toBe(STAFF_ACCESS_UNAVAILABLE_HREF);
    expect(
      resolveStaffSessionRedirect({
        pathname: "/staff/login",
        gate: "ok",
      }),
    ).toBe(STAFF_TODAY_HREF);
  });

  it("does not treat navigation hide as authorization", () => {
    expect(
      resolveStaffRolePageAccess({
        authenticated: true,
        role: "STAFF",
        isActive: true,
        allowedRoles: STAFF_SETTINGS_ROLES,
      }),
    ).toBe("forbidden");
    expect(
      resolveStaffRolePageAccess({
        authenticated: true,
        role: "STAFF",
        isActive: true,
        allowedRoles: STAFF_FINANCE_ROLES,
      }),
    ).toBe("forbidden");
    expect(
      resolveStaffRolePageAccess({
        authenticated: true,
        role: "OWNER",
        isActive: true,
        allowedRoles: STAFF_SETTINGS_ROLES,
      }),
    ).toBe("ok");
  });
});

describe("2B-1 source contracts stay closed", () => {
  it("keeps inviteStaffLoginAction fail-closed and never sends or early-binds", () => {
    const actions = source("lib/staff-auth/actions.ts");
    expect(actions).toMatch(/isStaffInvitePilotEnabled/);
    expect(actions).toMatch(/evaluateStaffInviteRequest/);
    expect(actions).toMatch(/void input\.redirectTo/);
    expect(actions).toMatch(/invite_send_closed/);
    expect(actions).not.toMatch(/inviteUserByEmail/);
    expect(actions).not.toMatch(/bindServerStaffMembershipAuthUser/);
    expect(actions).not.toMatch(/admin\.createUser/);
    expect(actions).not.toMatch(/createUser\(/);
  });

  it("does not reopen Auth CREATE, Appointment MUTATE, Stored Value, or Schedule WRITE", () => {
    expect(STORED_VALUE_WRITE_OPEN).toBe(false);
    expect(STAFF_REMOTE_CREATE_PILOT_ENV).toBe("BEAUTY_OS_STAFF_REMOTE_CREATE_PILOT");
    expect(APPOINTMENT_REMOTE_MUTATE_PILOT_ENV).toBe(
      "BEAUTY_OS_APPOINTMENT_REMOTE_MUTATE_PILOT",
    );
    expect(source("lib/staff/staff-remote-write-pilot.ts")).not.toMatch(
      /inviteUserByEmail|admin\.createUser/,
    );
    expect(source("lib/staff/staff-write-guard.ts")).toMatch(/遠端班表尚未開放/);
    expect(source("features/staff/StaffOnboardingDialog.tsx")).toMatch(
      /不會建立登入帳號/,
    );
  });

  it("keeps the late-bind RPC additive and refuses full-table UPDATE", () => {
    expect(existsSync(path.join(ROOT, MIGRATION))).toBe(true);
    const sql = source(MIGRATION);
    expect(sql).toMatch(/create table if not exists public\.staff_login_invites/);
    expect(sql).toMatch(new RegExp(`create or replace function public\\.${BIND_INVITED_STAFF_AUTH_USER_RPC}`));
    expect(sql).toMatch(/security definer/);
    expect(sql).not.toMatch(/security invoker/);
    expect(sql).toMatch(/auth_user_id is null/);
    expect(sql).toMatch(/invited_auth_user_id is distinct from v_uid/);
    expect(sql).not.toMatch(/grant update \(auth_user_id\)/);
    expect(sql).not.toMatch(/create policy staff_auth_memberships_bind_invited/);
    expect(sql).not.toMatch(/grant update on public\.staff_auth_memberships to authenticated;/);
    expect(sql).not.toMatch(/grant update \(status/);
    expect(sql).not.toMatch(/grant delete on public\.staff_auth_memberships/);
    expect(sql).not.toMatch(/user_metadata/);
    expect(sql).not.toMatch(/create_operational_staff/);
    expect(sql).not.toMatch(/admin\.createUser|inviteUserByEmail/);
    expect(sql).toMatch(/Does not create Staff/);
    expect(MEMBERSHIP_ENJOYE_OWNER_ID).toMatch(/mem-enjoye-owner/);
  });

  it("adds server role layouts so STAFF cannot URL-guess settings or finance", () => {
    expect(source("app/staff/(app)/settings/layout.tsx")).toMatch(/requireStaffRolePage/);
    expect(source("app/staff/(app)/finance/layout.tsx")).toMatch(/STAFF_FINANCE_ROLES/);
    expect(source("app/staff/(app)/layout.tsx")).toMatch(/loadStaffSessionGate/);
    expect(source("lib/supabase/proxy.ts")).toMatch(/resolveStaffSessionRedirect/);
    expect(source("lib/supabase/proxy.ts")).toMatch(/staff_login_invites/);
  });
});
