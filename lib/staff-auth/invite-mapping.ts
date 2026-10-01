/**
 * Honest invite + mapping outcomes.
 * Never fake-rollback a created Auth user.
 */
export type InviteAuthResult =
  | { ok: true; authUserId: string }
  | { ok: false; message: string; authUserId?: string };

export type BindAuthResult = { ok: true } | { ok: false; message: string };

export type InviteMappingOutcome =
  | { kind: "invited_and_bound"; authUserId: string; message: null }
  | {
      kind: "invite_failed";
      membershipKept: true;
      authUserId: null;
      message: string;
    }
  | {
      kind: "mapping_failed";
      membershipKept: true;
      authUserId: string;
      message: string;
    }
  | {
      kind: "not_configured";
      membershipKept: true;
      authUserId: null;
      message: string;
    };

export function extractInvitedAuthUserId(input: {
  userId?: string | null;
  identities?: Array<{ user_id?: string | null; id?: string | null }> | null;
}): string | null {
  if (input.userId) return input.userId;
  const fromIdentity = input.identities?.find((item) => item.user_id)?.user_id;
  return fromIdentity || null;
}

export function interpretInviteAndBind(input: {
  configured: boolean;
  invite: InviteAuthResult;
  bind?: BindAuthResult | null;
}): InviteMappingOutcome {
  if (!input.configured) {
    return {
      kind: "not_configured",
      membershipKept: true,
      authUserId: null,
      message: "員工已建立，登入邀請失敗：登入邀請功能尚未設定",
    };
  }
  if (!input.invite.ok || !input.invite.authUserId) {
    return {
      kind: "invite_failed",
      membershipKept: true,
      authUserId: null,
      message: `員工已建立，登入邀請失敗${input.invite.ok ? "" : `：${input.invite.message}`}`,
    };
  }
  if (!input.bind || !input.bind.ok) {
    return {
      kind: "mapping_failed",
      membershipKept: true,
      authUserId: input.invite.authUserId,
      message: `邀請已寄出，但登入綁定失敗${input.bind?.ok === false ? `：${input.bind.message}` : ""}`,
    };
  }
  return {
    kind: "invited_and_bound",
    authUserId: input.invite.authUserId,
    message: null,
  };
}

export function inviteMappingUserMessage(outcome: InviteMappingOutcome): string | null {
  if (outcome.kind === "invited_and_bound") return null;
  return outcome.message;
}
