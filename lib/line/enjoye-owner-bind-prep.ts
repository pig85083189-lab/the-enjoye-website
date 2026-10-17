/**
 * Phase 2F-4 THE ENJOYE Owner bind-start preparation.
 * Display and decisions only. Does not issue bind codes or call LINE.
 */
import {
  evaluateOwnerSelfProductionIdentity,
  isForbiddenPreviewFixture,
  type OwnerSelfProductionBind,
} from "@/lib/line/automations/appointment-reminder-owner-self-production";
import { LINE_BROADCAST_SEND_OPEN } from "@/lib/line/line-flag";
import {
  LINE_AUTOMATION_KILL_SWITCH,
  LINE_AUTOMATION_SEND_OPEN,
  LINE_OWNER_SELF_GRANT_PERSIST_OPEN,
  LINE_OWNER_SELF_PUSH_OPEN,
} from "@/lib/line/automations/production-safe-flags";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";

/** Official webhook is still on the Preview alias. Do not flip. */
export const ENJOYE_OWNER_BIND_WEBHOOK_READY = false;
/** Code issue / consume stay closed until Owner approves a safe webhook cutover. */
export const ENJOYE_OWNER_BIND_ISSUE_OPEN = false;

export const ENJOYE_OWNER_BIND_TITLE = "THE ENJOYE 店長本人 LINE 綁定";
export const ENJOYE_OWNER_BIND_HINT =
  "此區塊只準備正式店長驗證碼綁定。正式 Webhook 尚未切換，不會產生驗證碼，也不會寫入綁定。";
export const ENJOYE_OWNER_BIND_WEBHOOK_WARNING =
  "正式 LINE Webhook 仍指向舊 Preview 別名，尚未確認可安全接手。此時不能產生驗證碼，也不能開始綁定。";
export const ENJOYE_OWNER_BIND_MATCH_UNAVAILABLE = "無法核對本人（未讀取綁定 staff id）";
export const ENJOYE_OWNER_BIND_ISSUE_LABEL = "產生 8 碼驗證碼";
export const ENJOYE_OWNER_BIND_DISABLED_HINT =
  "產生驗證碼與實際綁定都關閉。畫面「已綁定」不能代替本人核對。";
export const ENJOYE_OWNER_BIND_UNAVAILABLE = "正式環境未載入";

export type EnjoyeOwnerBindPrepActor = {
  organizationId?: string | null;
  staffUserId?: string | null;
  role?: string | null;
  isActive?: boolean;
};

export function enjoyeOwnerBindPrepFlagsClosed(): boolean {
  return (
    ENJOYE_OWNER_BIND_WEBHOOK_READY === false &&
    ENJOYE_OWNER_BIND_ISSUE_OPEN === false &&
    LINE_BROADCAST_SEND_OPEN === false &&
    LINE_AUTOMATION_SEND_OPEN === false &&
    LINE_OWNER_SELF_PUSH_OPEN === false &&
    LINE_AUTOMATION_KILL_SWITCH === false &&
    LINE_OWNER_SELF_GRANT_PERSIST_OPEN === false
  );
}

export function canShowEnjoyeOwnerBindPrep(actor: EnjoyeOwnerBindPrepActor): boolean {
  return (
    (actor.organizationId ?? "").trim() === ORG_ENJOYE_ID &&
    actor.role === "OWNER" &&
    actor.isActive === true &&
    !isForbiddenPreviewFixture(actor.organizationId)
  );
}

export function maskLineChannelId(channelId?: string | null): string {
  const id = (channelId ?? "").trim();
  if (!id) return ENJOYE_OWNER_BIND_UNAVAILABLE;
  if (id.length <= 4) return "••••";
  return `••••${id.slice(-4)}`;
}

export function evaluateEnjoyeOwnerBindIdentity(input: {
  actor: EnjoyeOwnerBindPrepActor;
  bind?: OwnerSelfProductionBind | null;
}): ReturnType<typeof evaluateOwnerSelfProductionIdentity> {
  return evaluateOwnerSelfProductionIdentity({
    actor: input.actor,
    bind: input.bind ?? {},
  });
}

export function evaluateEnjoyeOwnerBindIssue(input: {
  actor: EnjoyeOwnerBindPrepActor;
  bind?: OwnerSelfProductionBind | null;
}): { ok: boolean; reason: string; message: string } {
  if (!canShowEnjoyeOwnerBindPrep(input.actor)) {
    return { ok: false, reason: "unauthorized", message: "只有 THE ENJOYE 在職店長可以使用正式綁定準備" };
  }
  if (isForbiddenPreviewFixture(input.bind?.organizationId) || isForbiddenPreviewFixture(input.bind?.staffUserId)) {
    return { ok: false, reason: "unbound", message: "不可使用 Preview TEST 或假綁定資料" };
  }
  const webhookReady = ENJOYE_OWNER_BIND_WEBHOOK_READY;
  const issueOpen = ENJOYE_OWNER_BIND_ISSUE_OPEN;
  if (!webhookReady || !issueOpen) {
    return {
      ok: false,
      reason: "send_closed",
      message: "正式 Webhook 尚未切換，不能產生驗證碼",
    };
  }
  return { ok: false, reason: "send_closed", message: "正式驗證碼發行尚未開放" };
}

export function enjoyeOwnerBindMatchLabel(input: {
  actor: EnjoyeOwnerBindPrepActor;
  bind?: OwnerSelfProductionBind | null;
}): string {
  const bindStaff = (input.bind?.staffUserId ?? "").trim();
  if (!bindStaff) return ENJOYE_OWNER_BIND_MATCH_UNAVAILABLE;
  const identity = evaluateEnjoyeOwnerBindIdentity(input);
  if (identity.reason === "ok") return "登入店長與綁定本人一致，但仍須官方 Webhook 驗證";
  if (identity.reason === "unbound") return identity.message;
  return identity.message;
}
