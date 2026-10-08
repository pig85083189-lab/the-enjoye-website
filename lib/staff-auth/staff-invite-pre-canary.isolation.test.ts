import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import {
  evaluateStaffInviteBind,
  evaluateStaffInviteRequest,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import {
  resolveStaffInviteRedirect,
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_SUPABASE_HOST,
} from "@/lib/staff-auth/staff-invite-redirect";
import {
  canAttachLookedUpAuthUserToPendingInvite,
  classifyStaffInviteAuthEmail,
  evaluateStaffPasswordSetup,
  interpretInviteAcceptability,
  interpretInviteRowAfterSend,
  passwordSetupMustNotClaimMembership,
  planStaffInviteDelivery,
  staffInviteDeliverySuccessMessage,
  STAFF_INVITE_ROW_TTL_MS,
  SUPABASE_AUTH_EMAIL_LINK_TTL_DEFAULT_SECONDS,
} from "@/lib/staff-auth/staff-invite-reconciliation";
import { executeRecoverableStaffInviteDelivery } from "@/lib/staff-auth/staff-invite-send-adapter";
import { resolveStaffAuthCallbackNext, STAFF_SETUP_PASSWORD_HREF } from "@/lib/staff-auth/staff-invite-gate";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";
const AUTH_INVITEE = "11111111-1111-4111-8111-111111111111";
const AUTH_OTHER = "22222222-2222-4222-8222-222222222222";
const TARGET_EMAIL = "vicky03070510@gmail.com";
const YIXIN = {
  id: "mem-muy4glz6-yfvh84",
  organizationId: ORG_ENJOYE_ID,
  userId: "staff-muy4glz6-0g09f4",
  email: TARGET_EMAIL,
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
    email: TARGET_EMAIL,
    invitedAuthUserId: AUTH_INVITEE,
    status: "pending",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-10-08T00:00:00.000Z",
    ...over,
  };
}

describe("2B-2 pre-canary: existing Auth user resend is not assumed", () => {
  it("does not treat an arbitrary same-email Auth user as the invitee", () => {
    expect(
      canAttachLookedUpAuthUserToPendingInvite({
        pendingInvite: pendingInvite({ invitedAuthUserId: null }),
        found: {
          id: AUTH_OTHER,
          emailConfirmedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
      }),
    ).toBe(false);
    expect(
      classifyStaffInviteAuthEmail({
        lookupOk: true,
        foundAuthUserId: AUTH_OTHER,
        foundAuthUser: {
          id: AUTH_OTHER,
          emailConfirmedAt: "2026-01-01T00:00:00.000Z",
          createdAt: "2025-01-01T00:00:00.000Z",
        },
        targetAuthUserId: null,
        pendingInvite: pendingInvite({ invitedAuthUserId: null }),
        boundMembershipId: null,
      }),
    ).toBe("unbound_existing");
    expect(
      planStaffInviteDelivery({
        classification: "unbound_existing",
        foundAuthUserId: AUTH_OTHER,
        existingInvite: pendingInvite({ invitedAuthUserId: null }),
        mode: "resend",
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: YIXIN.id,
        email: TARGET_EMAIL,
        actor: ownerActor(),
        target: YIXIN,
        authEmailClass: "unbound_existing",
        existingAuthUserIdForEmail: AUTH_OTHER,
        existingInvite: pendingInvite({ invitedAuthUserId: null }),
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("only attaches a looked-up user that already belongs to the pending invite or was created after it and is still unconfirmed", () => {
    expect(
      canAttachLookedUpAuthUserToPendingInvite({
        pendingInvite: pendingInvite(),
        found: { id: AUTH_INVITEE, emailConfirmedAt: null },
      }),
    ).toBe(true);
    expect(
      canAttachLookedUpAuthUserToPendingInvite({
        pendingInvite: pendingInvite({ invitedAuthUserId: null }),
        found: {
          id: AUTH_INVITEE,
          emailConfirmedAt: null,
          invitedAt: "2026-10-08T00:00:01.000Z",
          createdAt: "2026-10-08T00:00:01.000Z",
        },
      }),
    ).toBe(true);
    expect(
      canAttachLookedUpAuthUserToPendingInvite({
        pendingInvite: pendingInvite({ invitedAuthUserId: null }),
        found: {
          id: AUTH_INVITEE,
          emailConfirmedAt: null,
          createdAt: "2026-10-07T00:00:00.000Z",
        },
      }),
    ).toBe(false);
  });

  it("reports failure when inviteUserByEmail refuses an existing account instead of faking a resend success", async () => {
    const known = await executeRecoverableStaffInviteDelivery({
      mode: "resend",
      plan: {
        ok: true,
        persistFirst: true,
        sendEmail: true,
        reuseInviteId: "inv-yixin-canary",
        attachAuthUserId: AUTH_INVITEE,
        sendMethod: "resend_known",
        allowInviteExistingAuthUser: false,
      },
      persist: async () => ({ ok: true, inviteId: "inv-yixin-canary" }),
      sendInviteEmail: async () => ({
        ok: false,
        alreadyRegistered: true,
        message: "A user with this email address has already been registered",
      }),
    });
    expect(known).toMatchObject({
      ok: false,
      reason: "error",
      inviteId: "inv-yixin-canary",
      authUserId: AUTH_INVITEE,
    });
    expect(known.ok).toBe(false);

    const stranger = await executeRecoverableStaffInviteDelivery({
      mode: "invite",
      plan: {
        ok: true,
        persistFirst: true,
        sendEmail: true,
        reuseInviteId: null,
        attachAuthUserId: null,
        sendMethod: "invite_new",
        allowInviteExistingAuthUser: false,
      },
      persist: async () => ({ ok: true, inviteId: "inv-persist-first" }),
      sendInviteEmail: async () => ({
        ok: false,
        alreadyRegistered: true,
        message: "already registered",
      }),
    });
    expect(stranger).toMatchObject({
      ok: false,
      reason: "conflict",
      inviteId: "inv-persist-first",
    });
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/inviteUserByEmail/);
    expect(adapter).not.toMatch(/generateLink/);
    expect(adapter).not.toMatch(/resetPasswordForEmail/);
    expect(adapter).not.toMatch(/deleteUser/);
  });
});

describe("2B-2 pre-canary: send / RPC / expire / double-submit / redirect", () => {
  it("keeps send-fail and RPC-fail from reporting success", () => {
    expect(
      interpretInviteRowAfterSend({
        sendOk: false,
        persistOk: true,
        attachOk: false,
        authUserId: null,
        inviteId: "inv-persist-first",
      }),
    ).toMatchObject({ ok: false, reason: "error" });
    expect(
      interpretInviteRowAfterSend({
        sendOk: true,
        persistOk: true,
        attachOk: false,
        authUserId: AUTH_INVITEE,
        inviteId: "inv-persist-first",
      }),
    ).toMatchObject({ ok: false, reason: "mapping_failed" });
  });

  it("refuses expired and revoked invites even if an old Auth link still opens setup-password", () => {
    expect(
      interpretInviteAcceptability({
        inviteStatus: "revoked",
        inviteExpiresAt: "2099-01-01T00:00:00.000Z",
        authLinkExpired: false,
      }),
    ).toBe("invite_revoked");
    expect(
      interpretInviteAcceptability({
        inviteStatus: "pending",
        inviteExpiresAt: "2020-01-01T00:00:00.000Z",
        authLinkExpired: false,
      }),
    ).toBe("invite_expired");
    expect(
      interpretInviteAcceptability({
        inviteStatus: "pending",
        inviteExpiresAt: "2099-01-01T00:00:00.000Z",
        authLinkExpired: true,
      }),
    ).toBe("auth_link_expired");
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ status: "revoked" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "expired" });
  });

  it("documents that Auth email links expire far sooner than the 7-day invite row", () => {
    expect(STAFF_INVITE_ROW_TTL_MS).toBe(7 * 24 * 60 * 60 * 1000);
    expect(SUPABASE_AUTH_EMAIL_LINK_TTL_DEFAULT_SECONDS).toBe(3600);
    expect(STAFF_INVITE_ROW_TTL_MS).toBeGreaterThan(
      SUPABASE_AUTH_EMAIL_LINK_TTL_DEFAULT_SECONDS * 1000,
    );
    expect(staffInviteDeliverySuccessMessage()).toMatch(/1 小時/);
    expect(staffInviteDeliverySuccessMessage()).toMatch(/不是 7 天/);
    expect(staffInviteDeliverySuccessMessage()).not.toMatch(/已啟用工作台/);
    const setup = source("app/staff/auth/setup-password/page.tsx");
    expect(setup).toMatch(/請店長重寄/);
    expect(source("features/staff/StaffInvitePanel.tsx")).toMatch(/result\.message/);
  });

  it("collapses a second concurrent invite on the same membership to resend and unique-pending SQL", () => {
    const first = evaluateStaffInviteRequest({
      invitePilotEnabled: true,
      inviteSendOpen: true,
      organizationId: ORG_ENJOYE_ID,
      membershipId: YIXIN.id,
      email: TARGET_EMAIL,
      actor: ownerActor(),
      target: YIXIN,
    });
    const second = evaluateStaffInviteRequest({
      invitePilotEnabled: true,
      inviteSendOpen: true,
      organizationId: ORG_ENJOYE_ID,
      membershipId: YIXIN.id,
      email: TARGET_EMAIL,
      actor: ownerActor(),
      target: YIXIN,
      existingInvite: pendingInvite({ invitedAuthUserId: null }),
    });
    expect(first).toEqual({ ok: true, email: TARGET_EMAIL, mode: "invite" });
    expect(second).toEqual({ ok: true, email: TARGET_EMAIL, mode: "resend" });
    const create = source(
      "supabase/migrations/20261008130000_staff_login_invite_create.sql",
    );
    const foundation = source(
      "supabase/migrations/20261008120000_staff_login_invite_foundation.sql",
    );
    expect(foundation).toMatch(/staff_login_invites_one_pending_membership/);
    expect(create).toMatch(/pending invite exists/);
    expect(create).toMatch(/unique_violation/);
  });

  it("isolates Preview invite redirects from Production", () => {
    const leaked = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "production",
      VERCEL_URL: "the-enjoye-website.vercel.app",
    });
    expect(leaked.ok).toBe(false);
    const preview = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "preview",
      VERCEL_URL: "the-enjoye-website-preview-1.vercel.app",
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.origin).not.toBe(PRODUCTION_STAFF_ORIGIN);
      expect(preview.redirectTo).toContain("/staff/auth/callback?next=/staff/auth/setup-password");
    }
    const production = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
    });
    expect(production).toMatchObject({ ok: true, origin: PRODUCTION_STAFF_ORIGIN });
  });
});

describe("2B-2 pre-canary: password setup vs recovery and 130000 compatibility", () => {
  it("keeps bound-account recovery off invite claim and invite bind off recovery", () => {
    expect(
      evaluateStaffPasswordSetup({
        authenticated: true,
        boundActiveMembership: true,
        pendingInviteForAuthUser: true,
      }),
    ).toBe("recovery");
    expect(passwordSetupMustNotClaimMembership("recovery")).toBe(true);
    expect(
      resolveStaffAuthCallbackNext({
        gate: "ok",
        requestedNext: STAFF_SETUP_PASSWORD_HREF,
      }),
    ).toBe(STAFF_SETUP_PASSWORD_HREF);
    expect(source("app/staff/auth/forgot-password/page.tsx")).toMatch(
      /resetPasswordForEmail/,
    );
    expect(source("app/staff/auth/setup-password/page.tsx")).toMatch(
      /completeStaffPasswordSetupAction/,
    );
    expect(source("lib/staff-auth/actions.ts")).toMatch(/intent === "recovery"/);
    expect(source("lib/staff-auth/staff-invite-send-adapter.ts")).not.toMatch(
      /resetPasswordForEmail/,
    );
  });

  it("keeps 130000 additive to Preview 120000 without widening table writes", () => {
    const foundation = source(
      "supabase/migrations/20261008120000_staff_login_invite_foundation.sql",
    );
    const create = source(
      "supabase/migrations/20261008130000_staff_login_invite_create.sql",
    );
    expect(create).toMatch(/Does not rewrite 20261008120000/);
    expect(create).toMatch(/security definer/);
    expect(create).toMatch(/set search_path = public/);
    expect(create).toMatch(/revoke insert, update, delete on public\.staff_login_invites/);
    expect(create).not.toMatch(/grant insert on public\.staff_login_invites/);
    expect(create).not.toMatch(/grant update on public\.staff_login_invites to authenticated/);
    expect(create).not.toMatch(/set auth_user_id/);
    expect(foundation).toMatch(/invited_auth_user_id is distinct from v_uid/);
    expect(foundation).toMatch(/grant select on public\.staff_login_invites to authenticated/);
    expect(foundation).not.toMatch(/grant insert on public\.staff_login_invites/);
    expect(ORG_LUMIERE_ID).toMatch(/lumiere/);
  });
});
