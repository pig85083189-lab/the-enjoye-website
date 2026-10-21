/**
 * First-stage LINE delivery engine shared by broadcast and automation.
 *
 * In-memory claim + record only. Fail-closed: send flags stay shut, the mock
 * adapter never reaches LINE, and timeout / unknown outcomes are never retried.
 * Does not claim existing Broadcast rows, enable Cron, or apply remote SQL.
 */
import {
  LINE_AUTOMATION_JOB_NEVER_RESEND_STATUSES,
} from "@/lib/line/automations/schedule-types";
import {
  createMockLineMessagingAdapter,
  type LineDeliveryAdapter,
  type LineDeliveryAdapterResult,
} from "@/lib/line/delivery/delivery-adapter";
import { lineDeliveryKey } from "@/lib/line/delivery/delivery-key";
import {
  planLineDelivery,
  type DeliveryCandidate,
  type DeliveryDecision,
} from "@/lib/line/delivery/delivery-plan";
import {
  evaluateLineDeliveryRecipient,
  type LineDeliveryRecipientSnapshot,
} from "@/lib/line/delivery/delivery-recipient";
import type { LineHttpErrorClass } from "@/lib/line/line-types";

export const LINE_DELIVERY_TASK_PREFIX = "ldt-";

export const LINE_DELIVERY_NEVER_RESEND_STATUSES = [
  "claimed",
  ...LINE_AUTOMATION_JOB_NEVER_RESEND_STATUSES,
] as const;

export type LineDeliveryTaskStatus =
  | "planned"
  | "claimed"
  | "blocked"
  | "failed"
  | "canceled"
  | "skipped"
  | "pending_confirmation"
  | "accepted";

export type LineDeliveryErrorClass = LineHttpErrorClass | "send_closed" | "recipient_not_ready";

export type LineDeliveryTask = {
  id: string;
  deliveryKey: string;
  kind: DeliveryCandidate["kind"];
  organizationId: string;
  deliveryId: string;
  recipientId: string;
  status: LineDeliveryTaskStatus;
  decision: DeliveryDecision | "recipient_not_ready" | "adapter_closed";
  attemptCount: number;
  retryable: false;
  lastError: string | null;
  lastErrorClass: LineDeliveryErrorClass | null;
  sentLine: false;
  updatedAtMs: number;
};

export type LineDeliveryLedger = Map<string, LineDeliveryTask>;

export type LineDeliveryEngineResult = {
  task: LineDeliveryTask | null;
  decision: DeliveryDecision | "recipient_not_ready";
  sentLine: false;
  adapterCalled: boolean;
};

const NEVER_RESEND = new Set<string>(LINE_DELIVERY_NEVER_RESEND_STATUSES);

export function lineDeliveryTaskId(deliveryKey: string): string {
  return `${LINE_DELIVERY_TASK_PREFIX}${deliveryKey}`;
}

export function classifyLineDeliveryAdapterResult(
  result: LineDeliveryAdapterResult,
): {
  status: Extract<LineDeliveryTaskStatus, "blocked" | "failed" | "pending_confirmation" | "accepted">;
  retryable: false;
  errorClass: LineDeliveryErrorClass | null;
  message: string;
} {
  if (result.sentLine !== false) {
    return {
      status: "blocked",
      retryable: false,
      errorClass: "send_closed",
      message: "Mock adapter 不得回報已發送真實 LINE",
    };
  }
  if (result.localErrorClass === "send_closed" || result.httpOk !== true) {
    if (result.timedOut || result.localErrorClass === "timeout") {
      return {
        status: "pending_confirmation",
        retryable: false,
        errorClass: "timeout",
        message: result.message || "LINE API 逾時，系統已標記待確認，不會自動重送",
      };
    }
    if (
      result.localErrorClass === "unknown" ||
      (typeof result.httpStatus === "number" && result.httpStatus >= 500)
    ) {
      return {
        status: "pending_confirmation",
        retryable: false,
        errorClass: "unknown",
        message: result.message || "LINE API 回傳未知結果，系統已標記待確認，不會自動重送",
      };
    }
    if (result.localErrorClass === "send_closed" || result.httpStatus == null) {
      return {
        status: "blocked",
        retryable: false,
        errorClass: "send_closed",
        message: result.message || "發送開關關閉，未呼叫 LINE",
      };
    }
    return {
      status: "failed",
      retryable: false,
      errorClass: result.localErrorClass,
      message: result.message || "發送失敗，系統不會自動重送",
    };
  }
  return {
    status: "accepted",
    retryable: false,
    errorClass: null,
    message: result.message || "Mock adapter 接受，仍未發送真實 LINE",
  };
}

function blockedTask(
  candidate: DeliveryCandidate,
  deliveryKey: string,
  nowMs: number,
  decision: LineDeliveryTask["decision"],
  message: string,
  errorClass: LineDeliveryErrorClass | null,
): LineDeliveryTask {
  return {
    id: lineDeliveryTaskId(deliveryKey),
    deliveryKey,
    kind: candidate.kind,
    organizationId: candidate.organizationId,
    deliveryId: candidate.deliveryId,
    recipientId: candidate.recipientId,
    status: "blocked",
    decision,
    attemptCount: 0,
    retryable: false,
    lastError: message,
    lastErrorClass: errorClass,
    sentLine: false,
    updatedAtMs: nowMs,
  };
}

function neverResendKeys(ledger: LineDeliveryLedger): Set<string> {
  const keys = new Set<string>();
  for (const task of ledger.values()) {
    if (NEVER_RESEND.has(task.status)) keys.add(task.deliveryKey);
  }
  return keys;
}

export async function runLineDeliveryEngine(input: {
  candidate: DeliveryCandidate;
  recipient: LineDeliveryRecipientSnapshot | null;
  ledger: LineDeliveryLedger;
  nowMs: number;
  adapter?: LineDeliveryAdapter;
}): Promise<LineDeliveryEngineResult> {
  const adapter = input.adapter ?? createMockLineMessagingAdapter();
  const blocked = (
    decision: LineDeliveryEngineResult["decision"],
    task: LineDeliveryTask | null,
  ): LineDeliveryEngineResult => ({
    task,
    decision,
    sentLine: false,
    adapterCalled: false,
  });

  const deliveryKey = lineDeliveryKey(input.candidate);
  if (!deliveryKey) {
    return blocked("blocked_invalid_identity", null);
  }

  const existing = input.ledger.get(deliveryKey);
  if (existing && NEVER_RESEND.has(existing.status)) {
    return blocked("blocked_duplicate", existing);
  }

  if (input.candidate.kind === "automation") {
    const recipient = evaluateLineDeliveryRecipient({
      organizationId: input.candidate.organizationId,
      recipientId: input.candidate.recipientId,
      snapshot: input.recipient,
    });
    if (!recipient.ok) {
      const task = blockedTask(
        input.candidate,
        deliveryKey,
        input.nowMs,
        recipient.reason,
        recipient.message,
        recipient.reason === "recipient_not_ready" ? "recipient_not_ready" : null,
      );
      input.ledger.set(deliveryKey, task);
      return blocked(
        recipient.reason === "blocked_invalid_identity"
          ? "blocked_invalid_identity"
          : "recipient_not_ready",
        task,
      );
    }
  }

  const plan = planLineDelivery(input.candidate, {
    nowMs: input.nowMs,
    existingDeliveryKeys: neverResendKeys(input.ledger),
  });
  if (plan.decision !== "ready_for_review" || !plan.deliveryKey) {
    const task = blockedTask(
      input.candidate,
      deliveryKey,
      input.nowMs,
      plan.decision,
      "發送開關關閉或候選資料未通過規劃，未呼叫 LINE",
      "send_closed",
    );
    input.ledger.set(deliveryKey, task);
    return blocked(plan.decision, task);
  }

  const claimed: LineDeliveryTask = {
    id: lineDeliveryTaskId(deliveryKey),
    deliveryKey,
    kind: input.candidate.kind,
    organizationId: input.candidate.organizationId,
    deliveryId: input.candidate.deliveryId,
    recipientId: input.candidate.recipientId,
    status: "claimed",
    decision: plan.decision,
    attemptCount: 1,
    retryable: false,
    lastError: null,
    lastErrorClass: null,
    sentLine: false,
    updatedAtMs: input.nowMs,
  };
  input.ledger.set(deliveryKey, claimed);

  const adapterResult = await adapter.send({
    deliveryKey,
    textBody: input.candidate.message,
  });
  const classified = classifyLineDeliveryAdapterResult(adapterResult);
  const completed: LineDeliveryTask = {
    ...claimed,
    status: classified.status,
    decision: classified.status === "blocked" ? "adapter_closed" : claimed.decision,
    retryable: false,
    lastError: classified.message,
    lastErrorClass: classified.errorClass,
    sentLine: false,
    updatedAtMs: input.nowMs,
  };
  input.ledger.set(deliveryKey, completed);
  return {
    task: completed,
    decision:
      completed.status === "accepted"
        ? "ready_for_review"
        : completed.status === "pending_confirmation"
          ? "blocked_duplicate"
          : "blocked_send_closed",
    sentLine: false,
    adapterCalled: true,
  };
}
