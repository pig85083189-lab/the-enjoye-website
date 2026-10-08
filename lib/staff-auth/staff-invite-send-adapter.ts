/**
 * Server-only Staff invite delivery. Never import from Client Components.
 * inviteUserByEmail lives here so actions.ts stays fail-closed for 2B-1.
 * Bind never happens on this path. Tokens and passwords are not logged.
 */

import { createServiceRoleClient } from "@/lib/supabase/admin";
import { tryGetSupabaseServiceRoleKey } from "@/lib/supabase/env";
import { extractInvitedAuthUserId } from "@/lib/staff-auth/invite-mapping";
import {
  CREATE_STAFF_LOGIN_INVITE_RPC,
  interpretStaffInviteSendFailure,
  type StaffInviteRequestMode,
} from "@/lib/staff-auth/staff-invite-command";
import { isStaffInviteSendOpen } from "@/lib/staff-auth/staff-invite-flag";
import { createClient } from "@/lib/supabase/server";

export const STAFF_INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type StaffInviteSendResult =
  | { ok: true; authUserId: string; inviteId: string; mode: StaffInviteRequestMode }
  | {
      ok: false;
      reason:
        | "invite_send_closed"
        | "not_configured"
        | "conflict"
        | "invalid_email"
        | "error";
      message: string;
    };

export async function lookupAuthUserIdForStaffEmail(
  email: string,
): Promise<string | null> {
  if (typeof window !== "undefined") {
    throw new Error("Staff invite adapter cannot run in the browser");
  }
  const admin = createServiceRoleClient();
  if (!admin) return null;
  const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error || !data?.users) return null;
  const normalized = email.trim().toLowerCase();
  const found = data.users.find(
    (user) => (user.email ?? "").trim().toLowerCase() === normalized,
  );
  return found?.id ?? null;
}

export async function deliverStaffLoginInvite(input: {
  email: string;
  redirectTo: string;
  membershipId: string;
  organizationId: string;
  mode: StaffInviteRequestMode;
  existingInviteId?: string | null;
}): Promise<StaffInviteSendResult> {
  if (typeof window !== "undefined") {
    throw new Error("Staff invite adapter cannot run in the browser");
  }
  if (!isStaffInviteSendOpen()) {
    return {
      ok: false,
      reason: "invite_send_closed",
      message: "邀請寄送尚未開放",
    };
  }
  if (!tryGetSupabaseServiceRoleKey()) {
    return {
      ok: false,
      reason: "not_configured",
      message: "登入邀請功能尚未設定",
    };
  }
  const admin = createServiceRoleClient();
  if (!admin) {
    return {
      ok: false,
      reason: "not_configured",
      message: "登入邀請功能尚未設定",
    };
  }

  const existingAuthUserId = await lookupAuthUserIdForStaffEmail(input.email);
  if (existingAuthUserId && input.mode === "invite") {
    return {
      ok: false,
      reason: "conflict",
      message: "這個 Email 已經有登入帳號",
    };
  }

  const { data, error } = await admin.auth.admin.inviteUserByEmail(input.email, {
    redirectTo: input.redirectTo,
  });
  if (error) {
    return { ok: false, ...interpretStaffInviteSendFailure(error.message) };
  }
  const authUserId = extractInvitedAuthUserId({
    userId: data.user?.id,
    identities: data.user?.identities,
  });
  if (!authUserId) {
    return { ok: false, reason: "error", message: "邀請信寄送失敗" };
  }

  const expiresAt = new Date(Date.now() + STAFF_INVITE_TTL_MS).toISOString();
  const supabase = await createClient();
  const inserted = await supabase.rpc(CREATE_STAFF_LOGIN_INVITE_RPC, {
    p_membership_id: input.membershipId,
    p_email: input.email,
    p_invited_auth_user_id: authUserId,
    p_expires_at: expiresAt,
    p_existing_invite_id: input.existingInviteId ?? null,
  });
  if (inserted.error || !inserted.data) {
    return {
      ok: false,
      reason: "error",
      message: "邀請已建立登入帳號，但邀請紀錄寫入失敗",
    };
  }
  const payload = Array.isArray(inserted.data) ? inserted.data[0] : inserted.data;
  const inviteId =
    payload && typeof payload === "object" && "invite_id" in payload
      ? String((payload as { invite_id?: unknown }).invite_id ?? "")
      : "";
  if (!inviteId.startsWith("inv-")) {
    return {
      ok: false,
      reason: "error",
      message: "邀請已建立登入帳號，但邀請紀錄寫入失敗",
    };
  }
  return { ok: true, authUserId, inviteId, mode: input.mode };
}
