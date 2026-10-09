import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID, ORG_LUMIERE_ID } from "@/lib/tenant/constants";
import {
  CLAIM_STAFF_INVITE_CANARY_SEND_RPC,
  STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
  STAFF_INVITE_CANARY_CLAIM_ID,
  STAFF_INVITE_CANARY_EMAIL,
  STAFF_INVITE_CANARY_INVITE_ID,
  STAFF_INVITE_CANARY_MEMBERSHIP_ID,
  STAFF_INVITE_CANARY_ORGANIZATION_ID,
  STAFF_INVITE_CANARY_RESEND_ONLY_MESSAGE,
  STAFF_INVITE_CANARY_SUPABASE_REF,
  STAFF_INVITE_CANARY_USER_ID,
  evaluateStaffInviteCanarySend,
  interpretStaffInviteCanaryClaimRpc,
  isExactStaffInviteCanaryPendingResend,
  isStaffInviteCanaryEmail,
  staffInviteCanaryCreateIds,
} from "@/lib/staff-auth/staff-invite-canary";
import {
  evaluateStaffInviteBind,
  evaluateStaffInviteRequest,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import {
  isStaffInvitePilotEnabled,
  STAFF_INVITE_PILOT_ENV,
  STAFF_INVITE_SEND_OPEN,
} from "@/lib/staff-auth/staff-invite-flag";
import {
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_SUPABASE_HOST,
  STAFF_INVITE_CALLBACK_PATH,
  resolveStaffInviteRedirect,
} from "@/lib/staff-auth/staff-invite-redirect";
import {
  classifyStaffInviteAuthEmail,
  evaluateStaffPasswordSetup,
  planStaffInviteDelivery,
  type StaffInviteDeliveryPlan,
} from "@/lib/staff-auth/staff-invite-reconciliation";
import {
  executeCanaryStaffInviteResendDelivery,
  isStaffInviteCanaryResendPlan,
} from "@/lib/staff-auth/staff-invite-send-adapter";
import { prepareStaffOperationalCreateDraft } from "@/lib/staff/staff-remote-write-command";
import { staffAuthCallbackHref } from "@/lib/staff-auth/staff-auth-callback";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";
const AUTH_INVITEE = "11111111-1111-4111-8111-111111111111";
const AUTH_OTHER = "22222222-2222-4222-8222-222222222222";

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

function canaryPendingInvite(over: Partial<StaffInviteRecord> = {}): StaffInviteRecord {
  return {
    id: STAFF_INVITE_CANARY_INVITE_ID,
    membershipId: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
    organizationId: STAFF_INVITE_CANARY_ORGANIZATION_ID,
    email: STAFF_INVITE_CANARY_EMAIL,
    invitedAuthUserId: AUTH_INVITEE,
    status: "pending",
    expiresAt: "2099-01-01T00:00:00.000Z",
    createdAt: "2026-10-09T00:00:00.000Z",
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
    mode: "resend",
    existingInvite: canaryPendingInvite(),
    ...over,
  });
}

function canaryResendPlan(
  over: Partial<Extract<StaffInviteDeliveryPlan, { ok: true }>> = {},
): Extract<StaffInviteDeliveryPlan, { ok: true }> {
  return {
    ok: true,
    persistFirst: true,
    sendEmail: true,
    reuseInviteId: STAFF_INVITE_CANARY_INVITE_ID,
    attachAuthUserId: AUTH_INVITEE,
    sendMethod: "resend_known",
    allowInviteExistingAuthUser: false,
    ...over,
  };
}

function createSerializedMemoryClaim() {
  let claimed = false;
  let chain = Promise.resolve();
  return () =>
    new Promise<ReturnType<typeof interpretStaffInviteCanaryClaimRpc>>((resolve) => {
      chain = chain.then(() => {
        if (claimed) {
          resolve({
            ok: false,
            reason: "invite_send_closed",
            message: STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
          });
          return;
        }
        claimed = true;
        resolve({ ok: true });
      });
    });
}

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
    expect(STAFF_INVITE_CANARY_INVITE_ID).toBe("inv-30506ef33d4d4f68");
  });

  it("defaults the invite pilot off unless BEAUTY_OS_STAFF_INVITE_PILOT is exactly 1", () => {
    expect(STAFF_INVITE_PILOT_ENV).toBe("BEAUTY_OS_STAFF_INVITE_PILOT");
    expect(isStaffInvitePilotEnabled({})).toBe(false);
    expect(isStaffInvitePilotEnabled({ [STAFF_INVITE_PILOT_ENV]: "true" })).toBe(false);
    expect(isStaffInvitePilotEnabled({ [STAFF_INVITE_PILOT_ENV]: "0" })).toBe(false);
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: false,
        inviteSendOpen: false,
        canarySendAllowed: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: CANARY_TARGET.id,
        email: CANARY_TARGET.email,
        actor: ownerActor(),
        target: CANARY_TARGET,
        mode: "resend",
        existingInvite: canaryPendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "pilot_disabled" });
  });

  it("allows only the designated pending canary invite as resend_known", () => {
    expect(canaryInput()).toEqual({ ok: true });
    expect(canaryInput({ mode: "invite" })).toEqual({ ok: true });
    expect(isExactStaffInviteCanaryPendingResend(canaryPendingInvite())).toBe(true);
    expect(
      isStaffInviteCanaryResendPlan(canaryResendPlan(), canaryPendingInvite()),
    ).toBe(true);
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

  it("refuses other emails, memberships, orgs, invite ids, and a new invite", () => {
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
    expect(canaryInput({ organizationId: ORG_LUMIERE_ID })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ userId: "staff-001" })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(canaryInput({ existingInvite: null })).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
      message: STAFF_INVITE_CANARY_RESEND_ONLY_MESSAGE,
    });
    expect(
      canaryInput({
        existingInvite: canaryPendingInvite({ id: "inv-other-pending" }),
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
  });

  it("refuses accepted, revoked, expired, and unbound canary invites", () => {
    expect(
      canaryInput({
        existingInvite: canaryPendingInvite({ status: "accepted" }),
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(
      canaryInput({
        existingInvite: canaryPendingInvite({ status: "revoked" }),
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(
      canaryInput({
        existingInvite: canaryPendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    expect(
      canaryInput({
        existingInvite: canaryPendingInvite({ invitedAuthUserId: null }),
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
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

  it("lets the request evaluator through for the exact pending canary resend", () => {
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
        existingInvite: canaryPendingInvite(),
      }),
    ).toEqual({ ok: true, email: STAFF_INVITE_CANARY_EMAIL, mode: "resend" });
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
        existingInvite: canaryPendingInvite(),
      }),
    ).toEqual({ ok: true, email: STAFF_INVITE_CANARY_EMAIL, mode: "resend" });
  });

  it("refuses non-OWNER, bound STAFF, and terminal invite states even when canary ids match", () => {
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        canarySendAllowed: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: CANARY_TARGET.id,
        email: CANARY_TARGET.email,
        actor: ownerActor({ role: "MANAGER" }),
        target: CANARY_TARGET,
        mode: "resend",
        existingInvite: canaryPendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        canarySendAllowed: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: CANARY_TARGET.id,
        email: CANARY_TARGET.email,
        actor: ownerActor({ role: "STAFF" }),
        target: CANARY_TARGET,
        mode: "resend",
        existingInvite: canaryPendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        canarySendAllowed: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: CANARY_TARGET.id,
        email: CANARY_TARGET.email,
        actor: ownerActor(),
        target: { ...CANARY_TARGET, authUserId: AUTH_INVITEE },
        mode: "resend",
        existingInvite: canaryPendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
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
        existingInvite: canaryPendingInvite({ status: "accepted" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
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
        existingInvite: canaryPendingInvite({ status: "revoked" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
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
        existingInvite: canaryPendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      }),
    ).toMatchObject({ ok: false, reason: "invalid_invite" });
  });

  it("refuses invite_new and unbound_existing so a second Auth user cannot be created", () => {
    expect(
      planStaffInviteDelivery({
        classification: "not_found",
        foundAuthUserId: null,
        existingInvite: canaryPendingInvite({ invitedAuthUserId: null }),
        mode: "invite",
      }),
    ).toMatchObject({ ok: true, sendMethod: "invite_new" });
    expect(
      isStaffInviteCanaryResendPlan(
        {
          ok: true,
          persistFirst: true,
          sendEmail: true,
          reuseInviteId: STAFF_INVITE_CANARY_INVITE_ID,
          attachAuthUserId: null,
          sendMethod: "invite_new",
          allowInviteExistingAuthUser: false,
        },
        canaryPendingInvite(),
      ),
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
        pendingInvite: canaryPendingInvite(),
        boundMembershipId: null,
      }),
    ).toBe("unbound_existing");
    expect(
      planStaffInviteDelivery({
        classification: "unbound_existing",
        foundAuthUserId: AUTH_OTHER,
        existingInvite: canaryPendingInvite(),
        mode: "resend",
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
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
        authEmailClass: "unbound_existing",
        existingInvite: canaryPendingInvite(),
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
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

describe("Preview staff invite canary durable claim before send", () => {
  it("interprets Owner-session claim RPC success, already_claimed, and unauthorized", () => {
    expect(
      interpretStaffInviteCanaryClaimRpc({
        data: {
          ok: true,
          claim_id: STAFF_INVITE_CANARY_CLAIM_ID,
          invite_id: STAFF_INVITE_CANARY_INVITE_ID,
        },
        error: null,
      }),
    ).toEqual({ ok: true });
    expect(
      interpretStaffInviteCanaryClaimRpc({
        data: {
          ok: false,
          reason: "already_claimed",
          message: STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
        },
        error: null,
      }),
    ).toEqual({
      ok: false,
      reason: "invite_send_closed",
      message: STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
    });
    expect(
      interpretStaffInviteCanaryClaimRpc({
        data: null,
        error: { message: "unauthorized", code: "42501" },
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
    expect(
      interpretStaffInviteCanaryClaimRpc({
        data: null,
        error: { message: "already bound", code: "23505" },
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("allows one mocked canary resend after a successful claim and skips persist", async () => {
    let sendCalls = 0;
    const delivered = await executeCanaryStaffInviteResendDelivery({
      plan: canaryResendPlan(),
      existingInvite: canaryPendingInvite(),
      claim: async () => ({ ok: true }),
      sendInviteEmail: async () => {
        sendCalls += 1;
        return { ok: true, authUserId: AUTH_INVITEE };
      },
    });
    expect(delivered).toEqual({
      ok: true,
      authUserId: AUTH_INVITEE,
      inviteId: STAFF_INVITE_CANARY_INVITE_ID,
      mode: "resend",
    });
    expect(sendCalls).toBe(1);
  });

  it("refuses a second request after the durable claim is taken and does not send", async () => {
    const claim = createSerializedMemoryClaim();
    let sendCalls = 0;
    const sendInviteEmail = async () => {
      sendCalls += 1;
      return { ok: true as const, authUserId: AUTH_INVITEE };
    };
    const first = await executeCanaryStaffInviteResendDelivery({
      plan: canaryResendPlan(),
      existingInvite: canaryPendingInvite(),
      claim,
      sendInviteEmail,
    });
    const second = await executeCanaryStaffInviteResendDelivery({
      plan: canaryResendPlan(),
      existingInvite: canaryPendingInvite(),
      claim,
      sendInviteEmail,
    });
    expect(first.ok).toBe(true);
    expect(second).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
      message: STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
    });
    expect(sendCalls).toBe(1);
  });

  it("lets only one of two parallel requests call the send API", async () => {
    const claim = createSerializedMemoryClaim();
    let sendCalls = 0;
    let sendStarted = 0;
    const sendInviteEmail = async () => {
      sendStarted += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      sendCalls += 1;
      return { ok: true as const, authUserId: AUTH_INVITEE };
    };
    const [left, right] = await Promise.all([
      executeCanaryStaffInviteResendDelivery({
        plan: canaryResendPlan(),
        existingInvite: canaryPendingInvite(),
        claim,
        sendInviteEmail,
      }),
      executeCanaryStaffInviteResendDelivery({
        plan: canaryResendPlan(),
        existingInvite: canaryPendingInvite(),
        claim,
        sendInviteEmail,
      }),
    ]);
    const oks = [left.ok, right.ok];
    expect(oks.filter(Boolean)).toHaveLength(1);
    expect(oks.filter((ok) => !ok)).toHaveLength(1);
    expect(sendStarted).toBe(1);
    expect(sendCalls).toBe(1);
  });

  it("does not call the send API when claim fails", async () => {
    let sendCalls = 0;
    const delivered = await executeCanaryStaffInviteResendDelivery({
      plan: canaryResendPlan(),
      existingInvite: canaryPendingInvite(),
      claim: async () => ({
        ok: false,
        reason: "invite_send_closed",
        message: STAFF_INVITE_CANARY_ALREADY_CLAIMED_MESSAGE,
      }),
      sendInviteEmail: async () => {
        sendCalls += 1;
        throw new Error("inviteUserByEmail must not run after claim failure");
      },
    });
    expect(delivered).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
    expect(sendCalls).toBe(0);
  });

  it("does not retry inviteUserByEmail when Auth send fails after a successful claim", async () => {
    let sendCalls = 0;
    const delivered = await executeCanaryStaffInviteResendDelivery({
      plan: canaryResendPlan(),
      existingInvite: canaryPendingInvite(),
      claim: async () => ({ ok: true }),
      sendInviteEmail: async () => {
        sendCalls += 1;
        return {
          ok: false,
          alreadyRegistered: false,
          message: "SMTP timeout",
        };
      },
    });
    expect(delivered.ok).toBe(false);
    expect(sendCalls).toBe(1);
    expect(delivered).toMatchObject({
      inviteId: STAFF_INVITE_CANARY_INVITE_ID,
    });
  });

  it("stops on already registered and does not invent a second membership or Auth user", async () => {
    let sendCalls = 0;
    const delivered = await executeCanaryStaffInviteResendDelivery({
      plan: canaryResendPlan(),
      existingInvite: canaryPendingInvite(),
      claim: async () => ({ ok: true }),
      sendInviteEmail: async () => {
        sendCalls += 1;
        return {
          ok: false,
          alreadyRegistered: true,
          message: "A user with this email address has already been registered",
        };
      },
    });
    expect(delivered).toMatchObject({
      ok: false,
      reason: "error",
      authUserId: AUTH_INVITEE,
      inviteId: STAFF_INVITE_CANARY_INVITE_ID,
    });
    expect(sendCalls).toBe(1);
    const refusedNew = await executeCanaryStaffInviteResendDelivery({
      plan: {
        ...canaryResendPlan(),
        sendMethod: "invite_new",
        attachAuthUserId: null,
        reuseInviteId: null,
      },
      existingInvite: canaryPendingInvite(),
      claim: async () => {
        throw new Error("claim must not run for invite_new");
      },
      sendInviteEmail: async () => {
        throw new Error("send must not run for invite_new");
      },
    });
    expect(refusedNew).toMatchObject({
      ok: false,
      reason: "invite_send_closed",
    });
  });

  it("keeps invite PKCE callback, setup-password, and bind independent of the canary claim", () => {
    expect(STAFF_INVITE_CALLBACK_PATH).toContain("flow=invite");
    expect(staffAuthCallbackHref("invite")).toContain("flow=invite");
    const preview = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "preview",
      VERCEL_URL: "the-enjoye-website-git-cursor-staff-login-invite-2b1-7c7d.vercel.app",
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.redirectTo).toContain("/staff/auth/callback");
      expect(preview.redirectTo).toContain("flow=invite");
      expect(preview.redirectTo).not.toContain("the-enjoye-website.vercel.app");
    }
    expect(
      evaluateStaffPasswordSetup({
        authenticated: true,
        boundActiveMembership: false,
        pendingInviteForAuthUser: true,
      }),
    ).toBe("invite");
    expect(
      evaluateStaffInviteBind({
        invite: canaryPendingInvite(),
        membership: CANARY_TARGET,
        actorAuthUserId: AUTH_INVITEE,
        actorEmail: STAFF_INVITE_CANARY_EMAIL,
      }),
    ).toMatchObject({
      ok: true,
      membershipId: STAFF_INVITE_CANARY_MEMBERSHIP_ID,
      authUserId: AUTH_INVITEE,
      inviteId: STAFF_INVITE_CANARY_INVITE_ID,
    });
    const callback = source("app/staff/auth/callback/route.ts");
    expect(callback).toMatch(/loadStaffSessionGate/);
    expect(callback).not.toMatch(/claim_staff_invite_canary_send/);
    expect(callback).not.toMatch(/inviteUserByEmail/);
    const setup = source("app/staff/auth/setup-password/page.tsx");
    expect(setup).toMatch(/completeStaffPasswordSetupAction/);
    expect(setup).not.toMatch(/inviteUserByEmail/);
    expect(source("lib/staff-auth/actions.ts")).toMatch(/evaluateStaffInviteBind/);
    expect(source("lib/staff-auth/actions.ts")).toMatch(
      /BIND_INVITED_STAFF_AUTH_USER_RPC/,
    );
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
    expect(actions).not.toMatch(/claim_staff_invite_canary_send/);
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/evaluateStaffInviteCanarySend/);
    expect(adapter).toMatch(/isStaffInviteSendOpen/);
    expect(adapter).toMatch(/CLAIM_STAFF_INVITE_CANARY_SEND_RPC/);
    expect(adapter).toMatch(/createClient\(\)/);
    expect(adapter).toMatch(/skipPersist: true/);
    expect(adapter.indexOf("CLAIM_STAFF_INVITE_CANARY_SEND_RPC")).toBeLessThan(
      adapter.lastIndexOf("inviteUserByEmail"),
    );
    expect(adapter.indexOf("claimStaffInviteCanarySendFromOwnerSession")).toBeLessThan(
      adapter.lastIndexOf("inviteUserByEmail"),
    );
    expect(adapter).not.toMatch(/claimStaffInviteCanarySendAttempt/);
    expect(adapter).not.toMatch(/new Set/);
    expect(adapter).not.toMatch(/generateLink/);
    expect(adapter).not.toMatch(/resetPasswordForEmail/);
    expect(adapter).not.toMatch(/deleteUser/);
    expect(source("lib/staff-auth/staff-invite-canary.ts")).not.toMatch(/new Set/);
    expect(source("lib/staff-auth/staff-invite-canary.ts")).not.toMatch(
      /claimedCanarySends/,
    );
    const command = source("lib/staff-auth/staff-invite-command.ts");
    expect(command).toMatch(/canarySendAllowed/);
    expect(command).not.toMatch(/不得重寄/);
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

  it("keeps the Owner-only canary claim RPC from sending mail or mutating invites", () => {
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
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/claim_staff_invite_canary_send|CLAIM_STAFF_INVITE_CANARY_SEND_RPC/);
    expect(adapter).toMatch(/await createClient\(\)/);
    expect(adapter).not.toMatch(
      /createServiceRoleClient\(\)[\s\S]{0,80}claim_staff_invite_canary_send/,
    );
  });
});
