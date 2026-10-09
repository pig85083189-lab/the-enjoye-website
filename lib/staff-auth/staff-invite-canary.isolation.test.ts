import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import {
  CLAIM_STAFF_INVITE_CANARY_SEND_RPC,
  STAFF_INVITE_CANARY_CLAIM_ID,
  STAFF_INVITE_CANARY_EMAIL,
  STAFF_INVITE_CANARY_INVITE_ID,
  STAFF_INVITE_CANARY_MEMBERSHIP_ID,
  STAFF_INVITE_CANARY_ORGANIZATION_ID,
  STAFF_INVITE_CANARY_SUPABASE_REF,
  STAFF_INVITE_CANARY_USER_ID,
  claimStaffInviteCanarySendAttempt,
  evaluateStaffInviteCanarySend,
  hasStaffInviteCanarySendBeenClaimed,
  isStaffInviteCanaryEmail,
  resetStaffInviteCanarySendAttemptsForTests,
  staffInviteCanaryCreateIds,
} from "@/lib/staff-auth/staff-invite-canary";
import {
  evaluateStaffInviteRequest,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import { STAFF_INVITE_SEND_OPEN } from "@/lib/staff-auth/staff-invite-flag";
import {
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_SUPABASE_HOST,
} from "@/lib/staff-auth/staff-invite-redirect";
import { prepareStaffOperationalCreateDraft } from "@/lib/staff/staff-remote-write-command";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";

const PREVIEW_ENV = {
  VERCEL_ENV: "preview",
  NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
};

const CANARY_TARGET = {
  id: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
  organizationId: STAFF_INVITE_CANARY_ORGANIZATION_ID,
  userId: STAFF_INVITE_CANARY_USER_ID,
  email: STAFF_INVITE_CANARY_EMAIL,
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

function canaryInput(
  over: Partial<Parameters<typeof evaluateStaffInviteCanarySend>[0]> = {},
) {
  return evaluateStaffInviteCanarySend({
    env: PREVIEW_ENV,
    email: STAFF_INVITE_CANARY_EMAIL,
    membershipId: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
    organizationId: STAFF_INVITE_CANARY_ORGANIZATION_ID,
    userId: STAFF_INVITE_CANARY_USER_ID,
    mode: "invite",
    existingInvite: null,
    ...over,
  });
}

afterEach(() => {
  resetStaffInviteCanarySendAttemptsForTests();
});

describe("Preview staff invite canary allowlist", () => {
  it("pins Preview project, email, and designated membership", () => {
    expect(STAFF_INVITE_CANARY_SUPABASE_REF).toBe("bfzquejrtgqzzarhkiya");
    expect(PREVIEW_SUPABASE_HOST).toBe(`${STAFF_INVITE_CANARY_SUPABASE_REF}.supabase.co`);
    expect(STAFF_INVITE_CANARY_EMAIL).toBe("dog1060330@gmail.com");
    expect(isStaffInviteCanaryEmail("Dog1060330@gmail.com")).toBe(true);
    expect(isStaffInviteCanaryEmail("vicky03070510@gmail.com")).toBe(false);
    expect(staffInviteCanaryCreateIds()).toEqual({
      membershipId: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
      userId: STAFF_INVITE_CANARY_USER_ID,
    });
    expect(STAFF_INVITE_SEND_OPEN).toBe(false);
  });

  it("allows only the designated Preview invite when every constraint matches", () => {
    expect(canaryInput()).toEqual({ ok: true });
  });

  it("refuses Production, non-preview env, and the wrong Supabase project", () => {
    expect(
      canaryInput({
        env: {
          VERCEL_ENV: "production",
          NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
        },
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(
      canaryInput({
        env: {
          VERCEL_ENV: "preview",
          NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
        },
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(
      canaryInput({
        env: {
          VERCEL_ENV: "development",
          NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
        },
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(canaryInput({ env: {} })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
  });

  it("refuses other emails, existing Preview staff, other orgs, and resend", () => {
    expect(canaryInput({ email: "vicky03070510@gmail.com" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ membershipId: "mem-enjoye-owner" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ membershipId: "mem-mut4er9r-utb6rk" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ membershipId: "mem-muxyt6ng-sd04h2" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ membershipId: "mem-muy1eakb-sy9bwi" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ organizationId: ORG_LUMIERE_ID })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ userId: "staff-001" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ mode: "resend" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(
      canaryInput({
        existingInvite: {
          id: "inv-existing",
          membershipId: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
          organizationId: ORG_ENJOYE_ID,
          email: STAFF_INVITE_CANARY_EMAIL,
          invitedAuthUserId: null,
          status: "pending",
          expiresAt: "2099-01-01T00:00:00.000Z",
        } satisfies StaffInviteRecord,
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
  });

  it("allows at most one actual send claim and then refuses", () => {
    expect(
      claimStaffInviteCanarySendAttempt(
        STAFF_INVITE_CANARY_MEMBERSHIP_ID,
        STAFF_INVITE_CANARY_EMAIL,
      ),
    ).toBe(true);
    expect(
      hasStaffInviteCanarySendBeenClaimed(
        STAFF_INVITE_CANARY_MEMBERSHIP_ID,
        STAFF_INVITE_CANARY_EMAIL,
      ),
    ).toBe(true);
    expect(
      claimStaffInviteCanarySendAttempt(
        STAFF_INVITE_CANARY_MEMBERSHIP_ID,
        STAFF_INVITE_CANARY_EMAIL,
      ),
    ).toBe(false);
    expect(canaryInput()).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
  });

  it("does not let inviteSendOpen authorize a non-canary membership", () => {
    const yixin: StaffInviteTarget = {
      id: "mem-mut4er9r-utb6rk",
      organizationId: ORG_ENJOYE_ID,
      userId: "staff-mut4er9r-utb6rk",
      email: "vicky03070510@gmail.com",
      isActive: true,
      authUserId: null,
    };
    expect(
      evaluateStaffInviteCanarySend({
        env: PREVIEW_ENV,
        email: yixin.email,
        membershipId: yixin.id,
        organizationId: yixin.organizationId,
        userId: yixin.userId,
        mode: "invite",
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        canarySendAllowed: false,
        organizationId: ORG_ENJOYE_ID,
        membershipId: yixin.id,
        email: yixin.email,
        actor: ownerActor(),
        target: yixin,
        mode: "invite",
      }),
    ).toMatchObject({ ok: true });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        canarySendAllowed: false,
        organizationId: ORG_ENJOYE_ID,
        membershipId: yixin.id,
        email: yixin.email,
        actor: ownerActor(),
        target: yixin,
        mode: "invite",
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
  });

  it("lets the request evaluator through only when the canary allowlist already passed", () => {
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        canarySendAllowed: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: CANARY_TARGET.id,
        email: CANARY_TARGET.email,
        actor: ownerActor(),
        target: CANARY_TARGET,
        mode: "invite",
      }),
    ).toEqual({ ok: true, email: STAFF_INVITE_CANARY_EMAIL, mode: "invite" });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        canarySendAllowed: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: CANARY_TARGET.id,
        email: CANARY_TARGET.email,
        actor: ownerActor(),
        target: CANARY_TARGET,
        mode: "resend",
        existingInvite: {
          id: "inv-canary",
          membershipId: CANARY_TARGET.id,
          organizationId: ORG_ENJOYE_ID,
          email: STAFF_INVITE_CANARY_EMAIL,
          invitedAuthUserId: "11111111-1111-4111-8111-111111111111",
          status: "pending",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
  });

  it("forces canary create IDs on the server even if the client sends other ids", () => {
    const prepared = prepareStaffOperationalCreateDraft({
      displayName: "Canary",
      email: "Dog1060330@gmail.com",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      membershipId: "mem-other-staff",
      userId: "staff-other-staff",
    });
    expect(prepared.membershipId).toBe(STAFF_INVITE_CANARY_MEMBERSHIP_ID);
    expect(prepared.userId).toBe(STAFF_INVITE_CANARY_USER_ID);
    expect(prepared.email).toBe(STAFF_INVITE_CANARY_EMAIL);
    const other = prepareStaffOperationalCreateDraft({
      displayName: "Other",
      email: "preview.staff@example.com",
      role: "STAFF",
      locationIds: [LOC_ENJOYE_PRIMARY_ID],
      membershipId: "mem-other-staff",
      userId: "staff-other-staff",
    });
    expect(other.membershipId).toBe("mem-other-staff");
    expect(other.userId).toBe("staff-other-staff");
  });
});

describe("Preview staff invite canary source contracts", () => {
  it("keeps send closed except the server canary allowlist and does not embed protection secrets", () => {
    expect(STAFF_INVITE_SEND_OPEN).toBe(false);
    const actions = source("lib/staff-auth/actions.ts");
    expect(actions).toMatch(/evaluateStaffInviteCanarySend/);
    expect(actions).toMatch(/canarySendAllowed: canary\.ok/);
    expect(actions).toMatch(/if \(!canary\.ok\)/);
    expect(actions).not.toMatch(/inviteUserByEmail/);
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/evaluateStaffInviteCanarySend/);
    expect(adapter).toMatch(/isStaffInviteSendOpen/);
    expect(adapter).toMatch(/claimStaffInviteCanarySendAttempt/);
    expect(adapter.indexOf("claimStaffInviteCanarySendAttempt")).toBeLessThan(
      adapter.indexOf("inviteUserByEmail"),
    );
    const command = source("lib/staff-auth/staff-invite-command.ts");
    expect(command).toMatch(/canarySendAllowed/);
    const files = [
      "lib/staff-auth/staff-invite-canary.ts",
      "lib/staff-auth/actions.ts",
      "lib/staff-auth/staff-invite-send-adapter.ts",
      "lib/staff-auth/staff-invite-flag.ts",
      "features/staff/StaffInvitePanel.tsx",
      "features/staff/StaffOnboardingDialog.tsx",
    ];
    for (const rel of files) {
      const text = source(rel);
      expect(text).not.toMatch(/x-vercel-protection-bypass/i);
      expect(text).not.toMatch(/VERCEL_AUTOMATION_BYPASS_SECRET/);
      expect(text).not.toMatch(/x-vercel-set-bypass-cookie/i);
    }
    expect(source("lib/staff-auth/staff-invite-flag.ts")).toMatch(
      /STAFF_INVITE_SEND_OPEN = false/,
    );
  });

  it("adds a durable Owner-only canary claim RPC without wiring send or mutating invites", () => {
    expect(CLAIM_STAFF_INVITE_CANARY_SEND_RPC).toBe("claim_staff_invite_canary_send");
    expect(STAFF_INVITE_CANARY_CLAIM_ID).toBe(
      `canary-resend:${STAFF_INVITE_CANARY_INVITE_ID}`,
    );
    const sql = source(
      "supabase/migrations/20261009140000_staff_invite_canary_send_claim.sql",
    );
    expect(sql).toMatch(/create table if not exists public\.staff_invite_canary_send_claims/);
    expect(sql).toMatch(
      new RegExp(`create or replace function public\\.${CLAIM_STAFF_INVITE_CANARY_SEND_RPC}\\(\\)`),
    );
    expect(sql).toMatch(/security definer/);
    expect(sql).toMatch(/set search_path = public/);
    expect(sql).not.toMatch(/security invoker/);
    expect(sql).toMatch(/v_uid uuid := auth\.uid\(\)/);
    expect(sql).toMatch(/role = 'OWNER'/);
    expect(sql).not.toMatch(/p_owner|owner_id|claimed_by_auth/);
    expect(sql).toMatch(new RegExp(`id = '${STAFF_INVITE_CANARY_CLAIM_ID}'`));
    expect(sql).toMatch(new RegExp(`invite_id = '${STAFF_INVITE_CANARY_INVITE_ID}'`));
    expect(sql).toMatch(
      new RegExp(`membership_id = '${STAFF_INVITE_CANARY_MEMBERSHIP_ID}'`),
    );
    expect(sql).toMatch(/organization_id = 'org-the-enjoye'/);
    expect(sql).toMatch(new RegExp(`email = '${STAFF_INVITE_CANARY_EMAIL}'`));
    expect(sql).toMatch(/user_id is distinct from 'staff-preview-canary-dog1060330'/);
    expect(sql).toMatch(/role is distinct from 'STAFF'/);
    expect(sql).toMatch(/auth_user_id is not null/);
    expect(sql).toMatch(/invited_auth_user_id is null/);
    expect(sql).toMatch(/from auth\.users as u/);
    expect(sql).toMatch(/when unique_violation then/);
    expect(sql).toMatch(/already_claimed/);
    expect(sql).toMatch(/revoke all on function public\.claim_staff_invite_canary_send\(\)/);
    expect(sql).toMatch(/from public, anon/);
    expect(sql).toMatch(
      /revoke all on table public\.staff_invite_canary_send_claims\s+from public, anon, authenticated, service_role/,
    );
    expect(sql).toMatch(
      /grant execute on function public\.claim_staff_invite_canary_send\(\)\s+to authenticated/,
    );
    expect(sql).not.toMatch(/grant insert on table public\.staff_invite_canary_send_claims/);
    expect(sql).not.toMatch(/grant update on table public\.staff_invite_canary_send_claims/);
    expect(sql).not.toMatch(/grant delete on table public\.staff_invite_canary_send_claims/);
    expect(sql).not.toMatch(/update public\.staff_login_invites/);
    expect(sql).not.toMatch(/update public\.staff_auth_memberships/);
    expect(sql).not.toMatch(/insert into public\.staff_login_invites/);
    expect(sql).not.toMatch(/inviteUserByEmail|generateLink|resetPasswordForEmail|deleteUser/);
    expect(source("lib/staff-auth/staff-invite-send-adapter.ts")).not.toMatch(
      /claim_staff_invite_canary_send/,
    );
    expect(source("lib/staff-auth/actions.ts")).not.toMatch(
      /claim_staff_invite_canary_send/,
    );
    expect(canaryInput({ mode: "resend" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
  });
});
