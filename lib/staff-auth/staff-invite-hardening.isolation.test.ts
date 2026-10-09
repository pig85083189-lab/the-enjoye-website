import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import {
  evaluateStaffInviteBind,
  evaluateStaffInviteRequest,
  evaluateStaffInviteRevoke,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import {
  resolveStaffAuthCallbackNext,
  STAFF_ACCESS_UNAVAILABLE_HREF,
  STAFF_SETUP_PASSWORD_HREF,
  STAFF_TODAY_HREF,
} from "@/lib/staff-auth/staff-invite-gate";
import {
  AUTH_USER_LIST_MAX_PAGES,
  AUTH_USER_LIST_PAGE_SIZE,
  classifyStaffInviteAuthEmail,
  evaluateStaffPasswordSetup,
  interpretInviteRowAfterSend,
  interpretPasswordSetupCompletion,
  passwordSetupMustNotClaimMembership,
  planStaffInviteDelivery,
  reduceAuthUserListPages,
} from "@/lib/staff-auth/staff-invite-reconciliation";
import {
  executeRecoverableStaffInviteDelivery,
  lookupAuthUserIdForStaffEmail,
} from "@/lib/staff-auth/staff-invite-send-adapter";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";
const AUTH_INVITEE = "11111111-1111-4111-8111-111111111111";
const AUTH_OTHER = "22222222-2222-4222-8222-222222222222";
const AUTH_PAGE2 = "33333333-3333-4333-8333-333333333333";
const MIGRATION_FOUNDATION =
  "supabase/migrations/20261008120000_staff_login_invite_foundation.sql";
const MIGRATION_CREATE =
  "supabase/migrations/20261008130000_staff_login_invite_create.sql";
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
    ...over,
  };
}

function request(
  over: Partial<Parameters<typeof evaluateStaffInviteRequest>[0]> = {},
) {
  return evaluateStaffInviteRequest({
    invitePilotEnabled: true,
    inviteSendOpen: true,
    organizationId: ORG_ENJOYE_ID,
    membershipId: YIXIN.id,
    email: TARGET_EMAIL,
    actor: ownerActor(),
    target: YIXIN,
    ...over,
  });
}

function makeUsers(
  count: number,
  match?: { index: number; id: string; email: string },
) {
  return Array.from({ length: count }, (_, index) => {
    if (match && index === match.index) {
      return { id: match.id, email: match.email };
    }
    const n = String(index + 1).padStart(12, "0");
    return {
      id: `00000000-0000-4000-8000-${n}`,
      email: `user-${index}@example.com`,
    };
  });
}

describe("2B-2 hardening: recoverable send after persist-first", () => {
  it("does not report success when email is sent but the invite RPC/attach fails", async () => {
    const outcome = interpretInviteRowAfterSend({
      sendOk: true,
      persistOk: false,
      attachOk: false,
      authUserId: AUTH_INVITEE,
      inviteId: null,
    });
    expect(outcome).toMatchObject({
      ok: false,
      reason: "mapping_failed",
    });
    expect(outcome.ok).toBe(false);

    const delivered = await executeRecoverableStaffInviteDelivery({
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
      persist: async ({ existingInviteId }) => {
        if (existingInviteId) return { ok: false, message: "attach failed" };
        return { ok: true, inviteId: "inv-persist-first" };
      },
      sendInviteEmail: async () => ({ ok: true, authUserId: AUTH_INVITEE }),
    });
    expect(delivered).toMatchObject({
      ok: false,
      reason: "mapping_failed",
      authUserId: AUTH_INVITEE,
      inviteId: "inv-persist-first",
    });
  });

  it("keeps the invite row and refuses success when Auth create/send succeeds but attach fails", async () => {
    expect(
      interpretInviteRowAfterSend({
        sendOk: true,
        persistOk: true,
        attachOk: false,
        authUserId: AUTH_INVITEE,
        inviteId: "inv-persist-first",
      }),
    ).toMatchObject({
      ok: false,
      reason: "mapping_failed",
      authUserId: AUTH_INVITEE,
    });
  });

  it("retries and resends against the same pending invite instead of a second Auth user", async () => {
    expect(
      request({
        existingInvite: pendingInvite({ invitedAuthUserId: null }),
        authEmailClass: "not_found",
      }),
    ).toEqual({ ok: true, email: TARGET_EMAIL, mode: "resend" });

    const plan = planStaffInviteDelivery({
      classification: "pending_invite",
      foundAuthUserId: AUTH_INVITEE,
      existingInvite: pendingInvite(),
      mode: "resend",
    });
    expect(plan).toMatchObject({
      ok: true,
      reuseInviteId: "inv-yixin-canary",
      attachAuthUserId: AUTH_INVITEE,
    });

    const persistCalls: Array<{
      invitedAuthUserId: string | null;
      existingInviteId: string | null;
    }> = [];
    const delivered = await executeRecoverableStaffInviteDelivery({
      mode: "resend",
      plan: plan.ok
        ? plan
        : {
            ok: true,
            persistFirst: true,
            sendEmail: true,
            reuseInviteId: "inv-yixin-canary",
            attachAuthUserId: AUTH_INVITEE,
            sendMethod: "resend_known",
            allowInviteExistingAuthUser: false,
          },
      persist: async (input) => {
        persistCalls.push(input);
        return { ok: true, inviteId: "inv-yixin-canary" };
      },
      sendInviteEmail: async () => ({ ok: true, authUserId: AUTH_INVITEE }),
    });
    expect(delivered).toEqual({
      ok: true,
      authUserId: AUTH_INVITEE,
      inviteId: "inv-yixin-canary",
      mode: "resend",
    });
    expect(persistCalls[0]).toEqual({
      invitedAuthUserId: AUTH_INVITEE,
      existingInviteId: "inv-yixin-canary",
    });
    expect(persistCalls).toHaveLength(1);
  });

  it("keeps a persist-first row when send fails and does not delete Auth users", async () => {
    const delivered = await executeRecoverableStaffInviteDelivery({
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
        alreadyRegistered: false,
        message: "SMTP timeout",
      }),
    });
    expect(delivered).toMatchObject({
      ok: false,
      reason: "error",
      inviteId: "inv-persist-first",
    });
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/persistFirst|Persist the invite row first/);
    expect(adapter).not.toMatch(/deleteUser/);
    expect(adapter).not.toMatch(/admin\.createUser/);
  });
});

describe("2B-2 hardening: paginated Auth email lookup", () => {
  it("finds an email after the first 200 Auth users", async () => {
    const page1 = makeUsers(AUTH_USER_LIST_PAGE_SIZE);
    const page2 = makeUsers(10, {
      index: 3,
      id: AUTH_PAGE2,
      email: TARGET_EMAIL,
    });
    const reduced = reduceAuthUserListPages({
      email: TARGET_EMAIL,
      complete: true,
      pageSize: AUTH_USER_LIST_PAGE_SIZE,
      pages: [
        { ok: true, users: page1 },
        { ok: true, users: page2 },
      ],
    });
    expect(reduced).toMatchObject({ ok: true, authUserId: AUTH_PAGE2 });

    const lookedUp = await lookupAuthUserIdForStaffEmail(TARGET_EMAIL, async (page) => {
      if (page === 1) return { users: page1, error: null };
      if (page === 2) return { users: page2, error: null };
      return { users: [], error: { message: "should not page further" } };
    });
    expect(lookedUp).toMatchObject({ ok: true, authUserId: AUTH_PAGE2 });
  });

  it("fails closed when listUsers errors and never treats that as not_found", async () => {
    expect(
      reduceAuthUserListPages({
        email: TARGET_EMAIL,
        complete: false,
        pages: [{ ok: false, users: [] }],
      }),
    ).toMatchObject({ ok: false, reason: "lookup_failed" });
    expect(
      classifyStaffInviteAuthEmail({
        lookupOk: false,
        foundAuthUserId: null,
        targetAuthUserId: null,
        pendingInvite: null,
        boundMembershipId: null,
      }),
    ).toBe("lookup_failed");
    expect(
      planStaffInviteDelivery({
        classification: "lookup_failed",
        foundAuthUserId: null,
        existingInvite: null,
        mode: "invite",
      }),
    ).toMatchObject({ ok: false, reason: "error" });
    expect(
      request({ authEmailClass: "lookup_failed" }),
    ).toMatchObject({ ok: false, reason: "error" });

    const lookedUp = await lookupAuthUserIdForStaffEmail(TARGET_EMAIL, async () => ({
      users: undefined,
      error: { message: "Auth API unavailable" },
    }));
    expect(lookedUp).toMatchObject({ ok: false, reason: "lookup_failed" });
    expect(lookedUp.ok === false && lookedUp.reason === "lookup_failed").toBe(true);
    expect(AUTH_USER_LIST_MAX_PAGES * AUTH_USER_LIST_PAGE_SIZE).toBeGreaterThan(200);
  });

  it("classifies bound, unbound-existing, pending-invite, and not-found", () => {
    expect(
      classifyStaffInviteAuthEmail({
        lookupOk: true,
        foundAuthUserId: AUTH_OTHER,
        targetAuthUserId: AUTH_OTHER,
        pendingInvite: null,
        boundMembershipId: "mem-bound",
      }),
    ).toBe("bound");
    expect(
      classifyStaffInviteAuthEmail({
        lookupOk: true,
        foundAuthUserId: AUTH_OTHER,
        targetAuthUserId: null,
        pendingInvite: null,
        boundMembershipId: null,
      }),
    ).toBe("unbound_existing");
    expect(
      classifyStaffInviteAuthEmail({
        lookupOk: true,
        foundAuthUserId: AUTH_INVITEE,
        targetAuthUserId: null,
        pendingInvite: pendingInvite(),
        boundMembershipId: null,
      }),
    ).toBe("pending_invite");
    expect(
      classifyStaffInviteAuthEmail({
        lookupOk: true,
        foundAuthUserId: null,
        targetAuthUserId: null,
        pendingInvite: null,
        boundMembershipId: null,
      }),
    ).toBe("not_found");
    expect(
      planStaffInviteDelivery({
        classification: "unbound_existing",
        foundAuthUserId: AUTH_OTHER,
        existingInvite: null,
        mode: "invite",
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      planStaffInviteDelivery({
        classification: "bound",
        foundAuthUserId: AUTH_OTHER,
        existingInvite: null,
        mode: "invite",
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
  });
});

describe("2B-2 hardening: concurrent invite, expire, revoke", () => {
  it("keeps one pending invite per membership under concurrent create", () => {
    const sql = source(MIGRATION_CREATE);
    const foundation = source(MIGRATION_FOUNDATION);
    expect(foundation).toMatch(/staff_login_invites_one_pending_membership/);
    expect(foundation).toMatch(/where status = 'pending'/);
    expect(sql).toMatch(/for update/);
    expect(sql).toMatch(/pending invite exists/);
    expect(sql).toMatch(/unique_violation/);
    expect(
      request({
        existingInvite: pendingInvite({ invitedAuthUserId: null }),
      }).ok === true
        ? request({
            existingInvite: pendingInvite({ invitedAuthUserId: null }),
          })
        : { ok: false },
    ).toMatchObject({ ok: true, mode: "resend" });
  });

  it("refuses expired and revoked invites before workspace entry", () => {
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "expired" });
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite({ status: "revoked" }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
    expect(
      evaluateStaffInviteRevoke({
        invitePilotEnabled: true,
        actor: ownerActor(),
        invite: pendingInvite({ status: "revoked" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
  });
});

describe("2B-2 hardening: password setup, bind, and recovery", () => {
  it("does not show activation complete when password updates but bind fails", () => {
    expect(
      interpretPasswordSetupCompletion({
        passwordUpdated: true,
        intent: "invite",
        bindOk: false,
      }),
    ).toEqual({
      complete: false,
      showActivated: false,
      message: "密碼已儲存，但尚未取得工作台權限",
    });
    const setup = source("app/staff/auth/setup-password/page.tsx");
    expect(setup.indexOf("completeStaffPasswordSetupAction")).toBeLessThan(
      setup.lastIndexOf("/staff/today"),
    );
    expect(setup).toMatch(/尚未取得工作台權限/);
  });

  it("keeps bound-account password recovery off the invite claim path", () => {
    expect(
      evaluateStaffPasswordSetup({
        authenticated: true,
        boundActiveMembership: true,
        pendingInviteForAuthUser: true,
      }),
    ).toBe("recovery");
    expect(passwordSetupMustNotClaimMembership("recovery")).toBe(true);
    expect(
      interpretPasswordSetupCompletion({
        passwordUpdated: true,
        intent: "recovery",
        bindOk: false,
      }),
    ).toEqual({
      complete: true,
      showActivated: true,
      message: "密碼已設定",
    });
    expect(
      resolveStaffAuthCallbackNext({
        gate: "ok",
        requestedNext: STAFF_SETUP_PASSWORD_HREF,
      }),
    ).toBe(STAFF_SETUP_PASSWORD_HREF);
    expect(
      resolveStaffAuthCallbackNext({
        gate: "ok",
        requestedNext: STAFF_TODAY_HREF,
      }),
    ).toBe(STAFF_TODAY_HREF);
    expect(
      resolveStaffAuthCallbackNext({
        gate: "setup_password",
        requestedNext: STAFF_TODAY_HREF,
      }),
    ).toBe(STAFF_SETUP_PASSWORD_HREF);
    expect(
      resolveStaffAuthCallbackNext({
        gate: "access_unavailable",
        requestedNext: STAFF_TODAY_HREF,
      }),
    ).toBe(STAFF_ACCESS_UNAVAILABLE_HREF);
    const actions = source("lib/staff-auth/actions.ts");
    expect(actions).toMatch(/intent === "recovery"/);
    expect(actions).not.toMatch(/bindServerStaffMembershipAuthUser/);
  });

  it("requires email, Auth UUID, organization, and membership to match before bind", () => {
    const ok = evaluateStaffInviteBind({
      invite: pendingInvite(),
      membership: YIXIN,
      actorAuthUserId: AUTH_INVITEE,
      actorEmail: TARGET_EMAIL,
    });
    expect(ok).toMatchObject({
      ok: true,
      authUserId: AUTH_INVITEE,
      membershipId: YIXIN.id,
    });
    expect(isAuthUuid(YIXIN.userId)).toBe(false);
    expect(
      evaluateStaffInviteBind({
        invite: pendingInvite(),
        membership: { ...YIXIN, userId: AUTH_INVITEE },
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteBind({
        invite: null,
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
  });
});

describe("2B-2 hardening: STAFF / MANAGER / cross-org", () => {
  it("refuses STAFF and MANAGER invite, resend, and revoke", () => {
    for (const role of ["STAFF", "MANAGER"] as const) {
      expect(
        request({ actor: ownerActor({ role }) }),
      ).toMatchObject({ ok: false, reason: "unauthorized" });
      expect(
        evaluateStaffInviteRevoke({
          invitePilotEnabled: true,
          actor: ownerActor({ role }),
          invite: pendingInvite(),
        }),
      ).toMatchObject({ ok: false, reason: "unauthorized" });
    }
  });

  it("refuses cross-organization invite and revoke", () => {
    expect(
      request({
        organizationId: ORG_LUMIERE_ID,
        actor: ownerActor({ organizationId: ORG_LUMIERE_ID }),
        target: YIXIN,
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
      evaluateStaffInviteBind({
        invite: pendingInvite({ organizationId: ORG_LUMIERE_ID }),
        membership: YIXIN,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: TARGET_EMAIL,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
  });
});

describe("2B-2 hardening: migration and RPC contracts", () => {
  it("keeps DEFINER search_path, one pending row, and no authenticated table writes", () => {
    expect(existsSync(path.join(ROOT, MIGRATION_FOUNDATION))).toBe(true);
    expect(existsSync(path.join(ROOT, MIGRATION_CREATE))).toBe(true);
    const foundation = source(MIGRATION_FOUNDATION);
    const create = source(MIGRATION_CREATE);
    expect(foundation).toMatch(/security definer/);
    expect(foundation).toMatch(/set search_path = public/);
    expect(create).toMatch(/security definer/);
    expect(create).toMatch(/set search_path = public/);
    expect(create).not.toMatch(/security invoker/);
    expect(foundation).toMatch(/staff_login_invites_one_pending_membership/);
    expect(foundation).toMatch(/revoke all on public\.staff_login_invites from anon, authenticated, public/);
    expect(foundation).toMatch(/grant select on public\.staff_login_invites to authenticated/);
    expect(foundation).not.toMatch(/grant insert on public\.staff_login_invites/);
    expect(foundation).not.toMatch(/grant update on public\.staff_login_invites to authenticated/);
    expect(foundation).not.toMatch(/grant delete on public\.staff_login_invites/);
    expect(create).toMatch(/revoke insert, update, delete on public\.staff_login_invites/);
    expect(create).not.toMatch(/grant insert on public\.staff_login_invites/);
    expect(create).not.toMatch(/if p_invited_auth_user_id is null then/);
    expect(create).toMatch(/Null invited_auth_user_id is allowed/);
    expect(create).not.toMatch(/set auth_user_id/);
    expect(create).not.toMatch(/delete from auth\.users/);
    expect(foundation).toMatch(/invited_auth_user_id is distinct from v_uid/);
    expect(foundation).toMatch(/p_invite_id is null or p_invite_id not like 'inv-%'/);
    expect(foundation).not.toMatch(/user_metadata/);
    expect(source("lib/staff-auth/actions.ts")).toMatch(/loadPendingStaffInviteForAuthUser/);
    expect(source("lib/staff-auth/actions.ts")).not.toMatch(
      /acceptStaffInviteAction\(input/,
    );
  });
});
