/**
 * Mock LINE delivery worker. Claims one DB task, runs the mock adapter, and
 * completes it. Never calls LINE Messaging HTTP, never opens send flags,
 * never starts Cron. Mock accepted is not a real LINE delivery.
 */
import {
  createScriptedMockLineMessagingAdapter,
  type LineDeliveryAdapter,
  type LineDeliveryAdapterResult,
} from "@/lib/line/delivery/delivery-adapter";
import { classifyLineDeliveryAdapterResult } from "@/lib/line/delivery/delivery-engine";
import type { LineDeliveryDbStatus } from "@/lib/line/delivery/delivery-store";

export const LINE_DELIVERY_WORKER_KIND = "mock" as const;
export const LINE_DELIVERY_MOCK_ACCEPTED_CLASS = "mock_accepted" as const;
export const LINE_DELIVERY_WORKER_MAX_TICKS = 5;

export type LineDeliveryClaimedTask = {
  id: string;
  deliveryKey: string;
  kind: "broadcast" | "automation";
  status: "claimed";
  attemptCount: number;
};

export type LineDeliveryMockCompleteInput = {
  status: Extract<
    LineDeliveryDbStatus,
    "accepted" | "failed" | "blocked" | "pending_confirmation"
  >;
  lastError: string | null;
  errorClass: string | null;
  timedOut: boolean;
  httpStatus: number | null;
  mockAccepted: boolean;
  needsHumanConfirmation: boolean;
  sentLine: false;
};

export type LineDeliveryMockWorkerTickResult = {
  noWork: boolean;
  sentLine: false;
  mockAccepted: boolean;
  needsHumanConfirmation: boolean;
  complete: LineDeliveryMockCompleteInput | null;
  claimedId: string | null;
};

export function createLineDeliveryMockWorkerAdapter(): LineDeliveryAdapter {
  return createScriptedMockLineMessagingAdapter({
    timedOut: false,
    httpOk: true,
    httpStatus: null,
    localErrorClass: null,
    message: "Mock adapter 接受，仍未發送真實 LINE",
  });
}

export function parseLineDeliveryClaimedTask(payload: unknown): LineDeliveryClaimedTask | null {
  if (!payload || typeof payload !== "object") return null;
  const row = payload as Record<string, unknown>;
  if (row.ok !== true) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const deliveryKey = typeof row.delivery_key === "string" ? row.delivery_key.trim() : "";
  const kind = row.kind === "broadcast" || row.kind === "automation" ? row.kind : null;
  const attemptCount = typeof row.attempt_count === "number" ? row.attempt_count : 0;
  if (!id.startsWith("ldt-") || !deliveryKey || !kind || row.status !== "claimed") return null;
  return {
    id,
    deliveryKey,
    kind,
    status: "claimed",
    attemptCount,
  };
}

export function planLineDeliveryMockComplete(
  adapterResult: LineDeliveryAdapterResult,
): LineDeliveryMockCompleteInput {
  const classified = classifyLineDeliveryAdapterResult(adapterResult);
  const mockAccepted = classified.status === "accepted";
  return {
    status: classified.status,
    lastError: mockAccepted
      ? "Mock adapter 接受，仍未發送真實 LINE"
      : classified.message,
    errorClass: mockAccepted ? LINE_DELIVERY_MOCK_ACCEPTED_CLASS : classified.errorClass,
    timedOut: adapterResult.timedOut === true || classified.errorClass === "timeout",
    httpStatus: adapterResult.httpStatus,
    mockAccepted,
    needsHumanConfirmation: classified.status === "pending_confirmation",
    sentLine: false,
  };
}

export async function runLineDeliveryMockWorkerTick(input: {
  claimed: LineDeliveryClaimedTask | null;
  adapter?: LineDeliveryAdapter;
}): Promise<LineDeliveryMockWorkerTickResult> {
  const empty = (): LineDeliveryMockWorkerTickResult => ({
    noWork: true,
    sentLine: false,
    mockAccepted: false,
    needsHumanConfirmation: false,
    complete: null,
    claimedId: null,
  });
  if (!input.claimed) return empty();
  const adapter = input.adapter ?? createLineDeliveryMockWorkerAdapter();
  const adapterResult = await adapter.send({
    deliveryKey: input.claimed.deliveryKey,
    textBody: "mock-delivery-worker",
  });
  const complete = planLineDeliveryMockComplete(adapterResult);
  return {
    noWork: false,
    sentLine: false,
    mockAccepted: complete.mockAccepted,
    needsHumanConfirmation: complete.needsHumanConfirmation,
    complete,
    claimedId: input.claimed.id,
  };
}
