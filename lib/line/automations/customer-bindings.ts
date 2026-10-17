import type { LineActor } from "@/lib/line/line-command";
import { evaluateLineOwnerBindStart } from "@/lib/line/line-command";
import type { LineDecision } from "@/lib/line/line-command";

export const START_LINE_CUSTOMER_BIND_RPC = "start_line_customer_bind_challenge";
export const CONSUME_LINE_CUSTOMER_BIND_PUBLIC_RPC =
  "consume_line_customer_bind_challenge_public";
export const CONFIRM_LINE_CUSTOMER_BINDING_RPC = "confirm_line_customer_binding";
export const UNBIND_LINE_CUSTOMER_BINDING_RPC = "unbind_line_customer_binding";
export const CANCEL_LINE_CUSTOMER_REBIND_RPC = "cancel_line_customer_rebind";
export const READ_LINE_CUSTOMER_BINDINGS_RPC = "read_line_customer_bindings";

export type LineCustomerRebindPublic = {
  hint: string;
  capturedAt: string | null;
  expiresAt: string | null;
};

export type LineCustomerBindingPublic = {
  hint: string;
  verified: boolean;
  status: "pending" | "active" | "unbound";
  boundAt: string | null;
  confirmedAt: string | null;
  bindMethod: "webhook_code";
  rebind: LineCustomerRebindPublic | null;
};

export type LineCustomerBindingRow = {
  customerId: string;
  displayName: string;
  binding: LineCustomerBindingPublic | null;
};

export function evaluateLineCustomerBindStart(input: {
  connectionPilotEnabled: boolean;
  organizationId?: string | null;
  actor: LineActor;
  secretConfigured: boolean;
  customerId?: string | null;
  identityConfirmed?: boolean | null;
}): LineDecision {
  const started = evaluateLineOwnerBindStart({
    connectionPilotEnabled: input.connectionPilotEnabled,
    organizationId: input.organizationId,
    actor: input.actor,
    secretConfigured: input.secretConfigured,
  });
  if (!started.ok) return started;
  const customerId = (input.customerId ?? "").trim();
  if (!customerId) {
    return { ok: false, reason: "invalid_input", message: "缺少顧客識別" };
  }
  if (input.identityConfirmed !== true) {
    return { ok: false, reason: "invalid_input", message: "請先現場確認顧客身分" };
  }
  return { ok: true };
}

export function isTrustedCustomerBinding(
  binding: {
    verified?: boolean | null;
    status?: string | null;
    confirmedAt?: string | null;
  } | null | undefined,
): boolean {
  return (
    binding?.verified === true &&
    binding.status === "active" &&
    Boolean(binding.confirmedAt)
  );
}

export function evaluateLineAutomationSendRecipient(input: {
  binding?: {
    verified?: boolean | null;
    status?: string | null;
    confirmedAt?: string | null;
  } | null;
  jobStatus?: string | null;
}): { ok: true } | { ok: false; reason: "recipient_not_ready" } {
  if (isTrustedCustomerBinding(input.binding)) {
    return { ok: true };
  }
  return { ok: false, reason: "recipient_not_ready" };
}

export function mapLineCustomerBindingRows(
  organizationId: string,
  payload: unknown,
): LineCustomerBindingRow[] {
  if (!payload || typeof payload !== "object") return [];
  const org = (payload as { organization_id?: unknown }).organization_id;
  if (org !== organizationId) return [];
  const rows = (payload as { customers?: unknown }).customers;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const customerId =
      typeof (row as { customer_id?: unknown }).customer_id === "string"
        ? (row as { customer_id: string }).customer_id.trim()
        : "";
    if (!customerId) return [];
    const bindingRaw = (row as { binding?: unknown }).binding;
    const binding =
      bindingRaw && typeof bindingRaw === "object"
        ? {
            hint:
              typeof (bindingRaw as { hint?: unknown }).hint === "string"
                ? (bindingRaw as { hint: string }).hint
                : "••••",
            verified: (bindingRaw as { verified?: unknown }).verified === true,
            status:
              (bindingRaw as { status?: unknown }).status === "active" ||
              (bindingRaw as { status?: unknown }).status === "unbound" ||
              (bindingRaw as { status?: unknown }).status === "pending"
                ? ((bindingRaw as { status: "pending" | "active" | "unbound" }).status)
                : "pending",
            boundAt:
              typeof (bindingRaw as { bound_at?: unknown }).bound_at === "string"
                ? (bindingRaw as { bound_at: string }).bound_at
                : null,
            confirmedAt:
              typeof (bindingRaw as { confirmed_at?: unknown }).confirmed_at === "string"
                ? (bindingRaw as { confirmed_at: string }).confirmed_at
                : null,
            bindMethod: "webhook_code" as const,
            rebind: mapLineCustomerRebind((bindingRaw as { rebind?: unknown }).rebind),
          }
        : null;
    return [
      {
        customerId,
        displayName:
          typeof (row as { display_name?: unknown }).display_name === "string" &&
          (row as { display_name: string }).display_name.trim()
            ? (row as { display_name: string }).display_name.trim()
            : customerId,
        binding,
      } satisfies LineCustomerBindingRow,
    ];
  });
}

export function verifiedBindingCustomerIds(rows: readonly LineCustomerBindingRow[]): Set<string> {
  return new Set(
    rows.filter((row) => isTrustedCustomerBinding(row.binding)).map((row) => row.customerId),
  );
}

export function hasPendingCustomerRebind(
  binding: LineCustomerBindingPublic | null | undefined,
): boolean {
  return Boolean(binding?.rebind?.hint);
}

function mapLineCustomerRebind(value: unknown): LineCustomerRebindPublic | null {
  if (!value || typeof value !== "object") return null;
  const hint =
    typeof (value as { hint?: unknown }).hint === "string"
      ? (value as { hint: string }).hint
      : "";
  if (!hint.startsWith("••••")) return null;
  return {
    hint,
    capturedAt:
      typeof (value as { captured_at?: unknown }).captured_at === "string"
        ? (value as { captured_at: string }).captured_at
        : null,
    expiresAt:
      typeof (value as { expires_at?: unknown }).expires_at === "string"
        ? (value as { expires_at: string }).expires_at
        : null,
  };
}
