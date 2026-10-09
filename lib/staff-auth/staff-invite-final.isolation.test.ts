import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import {
  defaultStaffCreateInviteChecked,
  formatStaffCreateInviteNotice,
  shouldOfferStaffCreateInvite,
  validateStaffCreateInviteSelection,
} from "@/lib/staff-auth/staff-create-invite";
import {
  canShowStaffInviteControl,
  canShowStaffInviteStatus,
  deriveStaffInviteLifecycle,
  staffInviteLifecycleLabel,
  staffInviteSendButtonLabel,
  staffInviteSendMode,
} from "@/lib/staff-auth/staff-invite-visibility";
import {
  evaluateStaffInviteRequest,
  type StaffInviteActor,
  type StaffInviteRecord,
  type StaffInviteTarget,
} from "@/lib/staff-auth/staff-invite-command";
import { STAFF_INVITE_SEND_OPEN } from "@/lib/staff-auth/staff-invite-flag";
import { STAFF_HAS_AUTH_ACCOUNT_CREATE } from "@/lib/staff/staff-onboarding-derived";
import { STAFF_MANAGE_ROLES } from "@/lib/staff-auth/operational-capabilities";
import {
  PREVIEW_SUPABASE_HOST,
  PRODUCTION_STAFF_ORIGIN,
  PRODUCTION_SUPABASE_HOST,
  resolveStaffInviteRedirect,
} from "@/lib/staff-auth/staff-invite-redirect";
import {
  interpretInviteRowAfterSend,
  planStaffInviteDelivery,
  staffInviteAuthLinkExpiredMessage,
  staffInviteDeliverySuccessMessage,
} from "@/lib/staff-auth/staff-invite-reconciliation";
import { isAuthUuid } from "@/lib/staff-auth/staff-id";
import { buildStaffWorkspace } from "@/lib/staff/staff-workspace-derived";
import type { StaffMembership } from "@/types/saas";

const ROOT = process.cwd();
const AUTH_OWNER = "496f2538-8759-4038-b033-bc367e930cab";
const AUTH_INVITEE = "11111111-1111-4111-8111-111111111111";
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

describe("staff invite final: Owner create checkbox", () => {
  it("offers invite only to Owner on the operational write path, default checked", () => {
    expect(
      shouldOfferStaffCreateInvite({ actorRole: "OWNER", submitPath: "write" }),
    ).toBe(true);
    expect(
      defaultStaffCreateInviteChecked({ actorRole: "OWNER", submitPath: "write" }),
    ).toBe(true);
    expect(
      shouldOfferStaffCreateInvite({ actorRole: "MANAGER", submitPath: "write" }),
    ).toBe(false);
    expect(
      shouldOfferStaffCreateInvite({ actorRole: "STAFF", submitPath: "write" }),
    ).toBe(false);
    expect(
      shouldOfferStaffCreateInvite({ actorRole: "OWNER", submitPath: "create-auth" }),
    ).toBe(false);
    expect(
      shouldOfferStaffCreateInvite({ actorRole: "OWNER", submitPath: "local" }),
    ).toBe(false);
  });

  it("requires a valid email only when Owner chooses to send an invite", () => {
    expect(
      validateStaffCreateInviteSelection({ sendInvite: false, email: "" }),
    ).toBeNull();
    expect(
      validateStaffCreateInviteSelection({ sendInvite: true, email: "" }),
    ).toBe("寄送登入邀請需要有效的 Email");
    expect(
      validateStaffCreateInviteSelection({
        sendInvite: true,
        email: TARGET_EMAIL,
      }),
    ).toBeNull();
  });

  it("keeps membership and never pretends send succeeded", () => {
    expect(formatStaffCreateInviteNotice({ invite: null })).toBe("員工已建立");
    expect(
      formatStaffCreateInviteNotice({
        invite: { ok: true, message: staffInviteDeliverySuccessMessage() },
      }),
    ).toMatch(/^員工已建立。/);
    expect(
      formatStaffCreateInviteNotice({
        invite: {
          ok: false,
          reason: "invite_send_closed",
          message: "邀請寄送尚未開放",
        },
      }),
    ).toBe("員工已建立。登入邀請尚未開放，系統沒有寄信或建立登入帳號。");
    expect(
      formatStaffCreateInviteNotice({
        invite: {
          ok: false,
          reason: "conflict",
          message: "這個 Email 已經有登入帳號",
        },
      }),
    ).toBe("員工已建立。這個 Email 已經有登入帳號");
    expect(
      formatStaffCreateInviteNotice({
        invite: { ok: false, reason: "error", message: "邀請信寄送失敗" },
      }),
    ).toBe("員工已建立。邀請信寄送失敗");
    expect(
      formatStaffCreateInviteNotice({
        invite: {
          ok: false,
          reason: "conflict",
          message: "這個 Email 已經有登入帳號",
        },
      }),
    ).not.toMatch(/已寄出/);
  });
});

describe("staff invite final: lifecycle labels", () => {
  it("maps activated, waiting, send failed, expired, and unbound", () => {
    expect(
      deriveStaffInviteLifecycle({
        authUserId: AUTH_INVITEE,
        invite: pendingInvite(),
      }),
    ).toBe("activated");
    expect(
      staffInviteLifecycleLabel(
        deriveStaffInviteLifecycle({
          authUserId: AUTH_INVITEE,
          invite: pendingInvite(),
        }),
      ),
    ).toBe("已啟用");
    expect(
      deriveStaffInviteLifecycle({
        authUserId: null,
        invite: pendingInvite(),
      }),
    ).toBe("waiting_activation");
    expect(staffInviteLifecycleLabel("waiting_activation")).toBe("等待啟用");
    expect(
      deriveStaffInviteLifecycle({
        authUserId: null,
        invite: pendingInvite({ invitedAuthUserId: null }),
      }),
    ).toBe("send_failed");
    expect(staffInviteLifecycleLabel("send_failed")).toBe("寄送失敗");
    expect(
      deriveStaffInviteLifecycle({
        authUserId: null,
        invite: pendingInvite({ expiresAt: "2020-01-01T00:00:00.000Z" }),
      }),
    ).toBe("expired");
    expect(staffInviteLifecycleLabel("expired")).toBe("邀請已過期");
    expect(
      deriveStaffInviteLifecycle({ authUserId: null, invite: null }),
    ).toBe("unbound");
    expect(staffInviteSendButtonLabel("unbound")).toBe("寄送登入邀請");
    expect(staffInviteSendButtonLabel("waiting_activation")).toBe("重寄登入邀請");
    expect(staffInviteSendMode("send_failed")).toBe("resend");
    expect(staffInviteSendMode("expired")).toBe("invite");
    expect(staffInviteAuthLinkExpiredMessage()).toMatch(/請店長重寄/);
  });

  it("surfaces lifecycle on workspace rows without duplicating memberships", () => {
    const membership: StaffMembership = {
      id: YIXIN.id,
      organizationId: ORG_ENJOYE_ID,
      userId: YIXIN.userId,
      locationIds: ["loc-enjoye-main"],
      role: "STAFF",
      displayName: "宜欣",
      isActive: true,
      createdAt: "2026-01-01T00:00:00.000Z",
      email: TARGET_EMAIL,
      authUserId: null,
    };
    const built = buildStaffWorkspace({
      organizationId: ORG_ENJOYE_ID,
      locationId: "loc-enjoye-main",
      locationName: "主店",
      memberships: [membership],
      workingHours: [],
      breaks: [],
      timeOff: [],
      now: new Date("2026-10-09T00:00:00.000Z"),
      staffInvites: [pendingInvite({ invitedAuthUserId: null })],
    });
    expect(built.rows).toHaveLength(1);
    expect(built.rows[0]?.inviteLifecycle).toBe("send_failed");
    expect(built.rows[0]?.staffId).toBe(YIXIN.userId);
    expect(built.rows[0]?.staffId.startsWith("staff-")).toBe(true);
    expect(isAuthUuid(built.rows[0]?.staffId ?? "")).toBe(false);
  });
});

describe("staff invite final: Owner / STAFF permissions", () => {
  it("lets only Owner see invite status and send for unbound staff", () => {
    const eligible = {
      membershipId: YIXIN.id,
      organizationId: ORG_ENJOYE_ID,
      userId: YIXIN.userId,
      email: YIXIN.email,
      isActive: true,
      authUserId: null,
    };
    expect(STAFF_MANAGE_ROLES.has("OWNER")).toBe(true);
    expect(STAFF_MANAGE_ROLES.has("STAFF")).toBe(false);
    expect(
      canShowStaffInviteStatus({
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
        actorRole: "STAFF",
        actorActive: true,
        actorOrganizationId: ORG_ENJOYE_ID,
        target: eligible,
      }),
    ).toBe(false);
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
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: YIXIN.id,
        email: TARGET_EMAIL,
        actor: ownerActor({ role: "STAFF" }),
        target: YIXIN,
      }),
    ).toMatchObject({ ok: false, reason: "unauthorized" });
  });

  it("refuses existing Auth users, expired resend-without-row, and send-closed live delivery", () => {
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: true,
        organizationId: ORG_ENJOYE_ID,
        membershipId: YIXIN.id,
        email: TARGET_EMAIL,
        actor: ownerActor(),
        target: YIXIN,
        existingAuthUserIdForEmail: AUTH_INVITEE,
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      planStaffInviteDelivery({
        classification: "unbound_existing",
        foundAuthUserId: AUTH_INVITEE,
        existingInvite: null,
        mode: "invite",
      }),
    ).toMatchObject({ ok: false, reason: "conflict" });
    expect(
      evaluateStaffInviteRequest({
        invitePilotEnabled: true,
        inviteSendOpen: false,
        organizationId: ORG_ENJOYE_ID,
        membershipId: YIXIN.id,
        email: TARGET_EMAIL,
        actor: ownerActor(),
        target: YIXIN,
      }),
    ).toMatchObject({ ok: false, reason: "invite_send_closed" });
    const sendFailed = interpretInviteRowAfterSend({
      sendOk: false,
      persistOk: true,
      attachOk: false,
      authUserId: null,
      inviteId: "inv-yixin-canary",
    });
    expect(sendFailed.ok).toBe(false);
    if (!sendFailed.ok) {
      expect(sendFailed.message).toMatch(/邀請信寄送失敗/);
    }
  });
});

describe("staff invite final: source contracts stay closed", () => {
  it("wires create-then-invite without opening send, Auth UUID staff ids, or Production", () => {
    expect(STAFF_INVITE_SEND_OPEN).toBe(false);
    expect(STAFF_HAS_AUTH_ACCOUNT_CREATE).toBe(false);
    const dialog = source("features/staff/StaffOnboardingDialog.tsx");
    expect(dialog).toMatch(/data-staff-create-invite/);
    expect(dialog).toMatch(/寄送登入邀請/);
    expect(dialog).toMatch(/不會建立登入帳號/);
    expect(dialog).toMatch(/submitStaffOperationalCreate/);
    expect(dialog).toMatch(/inviteStaffLoginAction/);
    expect(dialog.indexOf("submitStaffOperationalCreate")).toBeLessThan(
      dialog.lastIndexOf("inviteStaffLoginAction"),
    );
    expect(dialog).not.toMatch(/inviteUserByEmail/);
    expect(dialog).not.toMatch(/admin\.createUser/);
    expect(source("features/staff/StaffInvitePanel.tsx")).toMatch(/寄送登入邀請/);
    expect(source("lib/staff-auth/staff-invite-flag.ts")).toMatch(
      /STAFF_INVITE_SEND_OPEN = false/,
    );
    expect(source("lib/staff-auth/actions.ts")).toMatch(/evaluateStaffInviteCanarySend/);
    const adapter = source("lib/staff-auth/staff-invite-send-adapter.ts");
    expect(adapter).toMatch(/persistFirst|Persist the invite row first/);
    expect(adapter).toMatch(/inviteUserByEmail/);
    expect(adapter).toMatch(/evaluateStaffInviteCanarySend/);
    expect(adapter).not.toMatch(/bind_invited_staff_auth_user/);
    expect(source("lib/staff-auth/actions.ts")).not.toMatch(/inviteUserByEmail/);
    expect(source("lib/staff-auth/staff-invite-reconciliation.ts")).toMatch(
      /請店長重寄/,
    );
    expect(source("lib/staff-auth/staff-auth-callback.ts")).toMatch(
      /staffInviteAuthLinkExpiredMessage/,
    );
    expect(source("app/staff/auth/setup-password/page.tsx")).toMatch(
      /staffSetupPasswordLinkErrorCopy/,
    );
    const preview = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
      VERCEL_ENV: "preview",
      VERCEL_URL: "the-enjoye-website-git-cursor-staff-login-invite-2b1-7c7d.vercel.app",
    });
    expect(preview.ok).toBe(true);
    if (preview.ok) {
      expect(preview.origin).not.toBe(PRODUCTION_STAFF_ORIGIN);
      expect(preview.redirectTo).toMatch(/\/staff\/auth\/callback/);
    }
    const production = resolveStaffInviteRedirect({
      NEXT_PUBLIC_SUPABASE_URL: `https://${PRODUCTION_SUPABASE_HOST}`,
    });
    expect(production.ok).toBe(true);
    if (production.ok) {
      expect(production.origin).toBe(PRODUCTION_STAFF_ORIGIN);
    }
    expect(
      resolveStaffInviteRedirect({
        NEXT_PUBLIC_SUPABASE_URL: `https://${PREVIEW_SUPABASE_HOST}`,
        VERCEL_ENV: "production",
      }).ok,
    ).toBe(false);
  });
});
