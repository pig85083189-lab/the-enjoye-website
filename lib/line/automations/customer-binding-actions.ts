"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { evaluateLineAutomationOwnerAccess } from "@/lib/line/automations/rules";
import {
  evaluateLineCustomerBindStart,
  mapLineCustomerBindingRows,
  READ_LINE_CUSTOMER_BINDINGS_RPC,
  START_LINE_CUSTOMER_BIND_RPC,
  UNBIND_LINE_CUSTOMER_BINDING_RPC,
  type LineCustomerBindingRow,
} from "@/lib/line/automations/customer-bindings";
import {
  resolveVerifiedLineOrganizationId,
  type LineActor,
} from "@/lib/line/line-command";
import { isLineConnectionPilotEnabled } from "@/lib/line/line-flag";
import { loadLineOfficialAccount } from "@/lib/line/line-load";
import type { LineDecisionReason } from "@/lib/line/line-types";
import { LINE_AUTOMATION_SEND_OPEN } from "@/lib/line/automations/production-safe-flags";
import { createClient } from "@/lib/supabase/server";

export type LineCustomerBindingActionResult<T = undefined> =
  | { ok: true; message: string; sentLine: false; data?: T }
  | { ok: false; reason: LineDecisionReason | "invalid_input"; message: string; sentLine: false };

function actorFromResolved(
  resolved: Awaited<ReturnType<typeof getAuthenticatedStaffMembership>>,
  authUserId: string | null,
): LineActor {
  return {
    authUserId,
    role: resolved.status === "ok" ? resolved.membership.role : null,
    isActive: resolved.status === "ok" ? resolved.membership.isActive : false,
    organizationId: resolved.status === "ok" ? resolved.membership.organizationId : null,
    userId: resolved.status === "ok" ? resolved.membership.userId : null,
  };
}

async function loadVerifiedOwner(requestedOrganizationId?: string | null) {
  const user = await getServerStaffAuthUser();
  const resolved = await getAuthenticatedStaffMembership({
    organizationId: requestedOrganizationId ?? undefined,
  });
  const actor = actorFromResolved(resolved, user?.id ?? null);
  const verified = resolveVerifiedLineOrganizationId({
    requestedOrganizationId,
    actor,
  });
  if (!verified.ok) return { ...verified, sentLine: false as const };
  const access = evaluateLineAutomationOwnerAccess({
    organizationId: verified.organizationId,
    actor,
  });
  if (!access.ok) return { ...access, sentLine: false as const };
  if (LINE_AUTOMATION_SEND_OPEN !== false) {
    return {
      ok: false as const,
      reason: "send_closed" as const,
      message: "自動發送開關異常，已停止綁定",
      sentLine: false as const,
    };
  }
  return { ok: true as const, actor, organizationId: verified.organizationId };
}

export async function loadLineCustomerBindings(
  organizationId: string,
): Promise<LineCustomerBindingActionResult<{ customers: LineCustomerBindingRow[] }>> {
  const verified = await loadVerifiedOwner(organizationId);
  if (!verified.ok) return verified;
  const supabase = await createClient();
  const read = await supabase.rpc(READ_LINE_CUSTOMER_BINDINGS_RPC, {
    p_organization_id: verified.organizationId,
  });
  if (read.error) {
    return { ok: false, reason: "error", message: "無法讀取顧客 LINE 綁定", sentLine: false };
  }
  return {
    ok: true,
    message: "已載入顧客 LINE 綁定狀態",
    sentLine: false,
    data: {
      customers: mapLineCustomerBindingRows(verified.organizationId, read.data),
    },
  };
}

export async function startLineCustomerBindAction(input: {
  organizationId: string;
  customerId: string;
}): Promise<LineCustomerBindingActionResult<{ code: string; expiresAt: string; customerId: string }>> {
  const verified = await loadVerifiedOwner(input.organizationId);
  if (!verified.ok) return verified;
  const account = await loadLineOfficialAccount(verified.organizationId);
  const decision = evaluateLineCustomerBindStart({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    organizationId: verified.organizationId,
    actor: verified.actor,
    secretConfigured: Boolean(account?.secretConfigured),
    customerId: input.customerId,
  });
  if (!decision.ok) return { ...decision, sentLine: false };
  const supabase = await createClient();
  const started = await supabase.rpc(START_LINE_CUSTOMER_BIND_RPC, {
    p_organization_id: verified.organizationId,
    p_customer_id: input.customerId.trim(),
  });
  const payload = started.data && typeof started.data === "object" ? started.data : {};
  const code = String((payload as { code?: unknown }).code ?? "");
  const expiresAt = String((payload as { expires_at?: unknown }).expires_at ?? "");
  const customerId = String((payload as { customer_id?: unknown }).customer_id ?? input.customerId);
  if (started.error || !/^[0-9A-F]{8}$/.test(code)) {
    return { ok: false, reason: "error", message: "無法產生顧客綁定驗證碼", sentLine: false };
  }
  return {
    ok: true,
    message: "請顧客用自己的 LINE 把驗證碼傳給本官方帳號。不要輸入 User ID。",
    sentLine: false,
    data: { code, expiresAt, customerId },
  };
}

export async function unbindLineCustomerBindingAction(input: {
  organizationId: string;
  customerId: string;
}): Promise<LineCustomerBindingActionResult> {
  const verified = await loadVerifiedOwner(input.organizationId);
  if (!verified.ok) return verified;
  const decision = evaluateLineCustomerBindStart({
    connectionPilotEnabled: isLineConnectionPilotEnabled(),
    organizationId: verified.organizationId,
    actor: verified.actor,
    secretConfigured: true,
    customerId: input.customerId,
  });
  if (!decision.ok) return { ...decision, sentLine: false };
  const supabase = await createClient();
  const unbound = await supabase.rpc(UNBIND_LINE_CUSTOMER_BINDING_RPC, {
    p_organization_id: verified.organizationId,
    p_customer_id: input.customerId.trim(),
  });
  if (unbound.error) {
    return { ok: false, reason: "error", message: "無法解除顧客 LINE 綁定", sentLine: false };
  }
  return { ok: true, message: "已解除顧客 LINE 綁定", sentLine: false };
}
