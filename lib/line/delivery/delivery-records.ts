/**
 * Owner-safe LINE delivery records. Never exposes LINE user ids, ciphers,
 * credentials, recipient_id, or delivery_key.
 */
import {
  LINE_DELIVERY_KIND_AUTOMATION,
  LINE_DELIVERY_KIND_BROADCAST,
  LINE_DELIVERY_MOCK_ACCEPTED,
  LINE_DELIVERY_MOCK_NOT_ACCEPTED,
  LINE_DELIVERY_NEEDS_CONFIRMATION,
  LINE_DELIVERY_NO_CONFIRMATION,
  LINE_DELIVERY_STATUS_ACCEPTED,
  LINE_DELIVERY_STATUS_BLOCKED,
  LINE_DELIVERY_STATUS_CLAIMED,
  LINE_DELIVERY_STATUS_FAILED,
  LINE_DELIVERY_STATUS_PENDING,
  LINE_DELIVERY_STATUS_PLANNED,
} from "@/lib/line/automations/copy";
import {
  LINE_DELIVERY_DB_STATUSES,
  type LineDeliveryDbStatus,
} from "@/lib/line/delivery/delivery-store";

export const LINE_DELIVERY_RECORD_KINDS = ["broadcast", "automation"] as const;

export type LineDeliveryRecordKind = (typeof LINE_DELIVERY_RECORD_KINDS)[number];

export type LineDeliveryRecord = {
  id: string;
  kind: LineDeliveryRecordKind;
  createdAt: string;
  status: LineDeliveryDbStatus;
  mockAccepted: boolean;
  lastError: string | null;
  needsHumanConfirmation: boolean;
  attemptCount: number;
  sentLine: false;
};

const STATUSES = new Set<string>(LINE_DELIVERY_DB_STATUSES);
const KINDS = new Set<string>(LINE_DELIVERY_RECORD_KINDS);
const FORBIDDEN_RECORD_KEYS = [
  "recipient_id",
  "delivery_key",
  "line_user_id",
  "line_user_id_cipher",
  "line_user_id_hash",
  "channel_access_token",
  "channel_secret",
] as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asStatus(value: unknown): LineDeliveryDbStatus | null {
  return typeof value === "string" && STATUSES.has(value)
    ? (value as LineDeliveryDbStatus)
    : null;
}

function asKind(value: unknown): LineDeliveryRecordKind | null {
  return typeof value === "string" && KINDS.has(value)
    ? (value as LineDeliveryRecordKind)
    : null;
}

export function mapLineDeliveryRecord(value: unknown): LineDeliveryRecord | null {
  const row = asRecord(value);
  if (!row) return null;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const kind = asKind(row.kind);
  const createdAt =
    typeof row.created_at === "string"
      ? row.created_at
      : typeof row.createdAt === "string"
        ? row.createdAt
        : "";
  const status = asStatus(row.status);
  if (!id.startsWith("ldt-") || !kind || !createdAt || !status) return null;
  const mockAccepted = row.mock_accepted === true || row.mockAccepted === true;
  const needsHumanConfirmation =
    row.needs_human_confirmation === true ||
    row.needsHumanConfirmation === true ||
    status === "pending_confirmation";
  const lastErrorRaw = row.last_error ?? row.lastError;
  const lastError = typeof lastErrorRaw === "string" && lastErrorRaw.trim() ? lastErrorRaw : null;
  const attemptRaw = row.attempt_count ?? row.attemptCount;
  const attemptCount = typeof attemptRaw === "number" && attemptRaw >= 0 ? attemptRaw : 0;
  return {
    id,
    kind,
    createdAt,
    status,
    mockAccepted: mockAccepted && status === "accepted",
    lastError,
    needsHumanConfirmation,
    attemptCount,
    sentLine: false,
  };
}

export function mapLineDeliveryRecords(payload: unknown): LineDeliveryRecord[] {
  const root = asRecord(payload);
  const list = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.records)
      ? root?.records
      : [];
  return list
    .map((row) => mapLineDeliveryRecord(row))
    .filter((row): row is LineDeliveryRecord => Boolean(row));
}

export function lineDeliveryRecordHasForbiddenKeys(value: unknown): boolean {
  const row = asRecord(value);
  if (!row) return false;
  return FORBIDDEN_RECORD_KEYS.some((key) => key in row);
}

export function lineDeliveryKindLabel(kind: LineDeliveryRecordKind): string {
  return kind === "broadcast" ? LINE_DELIVERY_KIND_BROADCAST : LINE_DELIVERY_KIND_AUTOMATION;
}

export function lineDeliveryStatusLabel(status: LineDeliveryDbStatus): string {
  switch (status) {
    case "planned":
      return LINE_DELIVERY_STATUS_PLANNED;
    case "claimed":
      return LINE_DELIVERY_STATUS_CLAIMED;
    case "blocked":
      return LINE_DELIVERY_STATUS_BLOCKED;
    case "accepted":
      return LINE_DELIVERY_STATUS_ACCEPTED;
    case "failed":
      return LINE_DELIVERY_STATUS_FAILED;
    case "pending_confirmation":
      return LINE_DELIVERY_STATUS_PENDING;
  }
}

export function lineDeliveryMockAcceptedLabel(mockAccepted: boolean): string {
  return mockAccepted ? LINE_DELIVERY_MOCK_ACCEPTED : LINE_DELIVERY_MOCK_NOT_ACCEPTED;
}

export function lineDeliveryConfirmationLabel(needsHumanConfirmation: boolean): string {
  return needsHumanConfirmation ? LINE_DELIVERY_NEEDS_CONFIRMATION : LINE_DELIVERY_NO_CONFIRMATION;
}
