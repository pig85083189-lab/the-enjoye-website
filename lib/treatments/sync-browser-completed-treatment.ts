/**
 * Move one browser-completed treatment onto the authoritative appointment.
 *
 * Browser completions use ids such as `treatment-${appointmentId}`. The remote
 * adapter only accepts generated `trt-*` ids, so the remote row gets a new id.
 * The appointment is the uniqueness key. A second attempt reads that row and
 * must not insert another treatment.
 *
 * Identity has to match the appointment already resolved for this screen.
 * This does not merge customers by name or phone, create members, or delete
 * the browser copy.
 */
import type { TreatmentDraft } from "@/types/treatment";
import { normalizeTreatmentDraft } from "@/lib/treatment-draft";
import { treatmentClinicalFieldsMatch } from "./completed-treatment-migration-preflight";
import { TreatmentDuplicateError } from "./treatment-write-errors";

export const BROWSER_SYNC_IDENTITY_MESSAGE =
  "本機療程身分與正式預約不一致，已保留瀏覽器紀錄並停止同步。";

export const BROWSER_SYNC_CONFLICT_MESSAGE =
  "正式資料庫已有不同內容的療程，已保留兩邊資料，請勿重複建立療程。";

export const BROWSER_SYNC_VERIFY_MESSAGE =
  "療程已送出但正式資料庫回讀驗證失敗，請勿重複建立療程。";

export const BROWSER_SYNC_PAUSE_MESSAGE =
  "本機已完成療程與正式資料庫尚未確認完全一致，已保留原始紀錄並暫停切換。請先驗證並補同步。";

export type BrowserCompletedHydration =
  | { action: "none" }
  | { action: "sync"; local: TreatmentDraft }
  | { action: "use-remote" }
  | { action: "stop"; message: string };

/**
 * Decide how to open a screen when the browser already has a completed
 * treatment for this appointment. A matching remote row is shown even when
 * its id differs from the browser id. Opening the screen never writes.
 */
export function decideBrowserCompletedHydration(input: {
  remoteWrite: boolean;
  localRecords: readonly TreatmentDraft[];
  remote: TreatmentDraft | null;
  identity: BrowserCompletedSyncIdentity;
}): BrowserCompletedHydration {
  if (input.localRecords.length === 0) return { action: "none" };
  if (input.localRecords.length !== 1) {
    return { action: "stop", message: BROWSER_SYNC_PAUSE_MESSAGE };
  }
  const local = input.localRecords[0]!;
  try {
    assertBrowserCompletedIdentity(local, input.identity);
  } catch (error: unknown) {
    return {
      action: "stop",
      message: error instanceof Error ? error.message : BROWSER_SYNC_IDENTITY_MESSAGE,
    };
  }
  const remote = input.remote;
  if (!remote) {
    if (!input.remoteWrite) return { action: "stop", message: BROWSER_SYNC_PAUSE_MESSAGE };
    return { action: "sync", local };
  }
  if (!sameIdentity(remote, input.identity) || !browserClinicalFieldsMatch(local, remote)) {
    return { action: "stop", message: BROWSER_SYNC_CONFLICT_MESSAGE };
  }
  if (remote.status === "completed") return { action: "use-remote" };
  if (!input.remoteWrite) return { action: "stop", message: BROWSER_SYNC_PAUSE_MESSAGE };
  return { action: "sync", local };
}

export interface BrowserCompletedSyncIdentity {
  organizationId: string;
  locationId?: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
}

export function assertBrowserCompletedIdentity(
  local: TreatmentDraft,
  identity: BrowserCompletedSyncIdentity,
): void {
  if (
    local.status !== "completed" ||
    !local.locationId ||
    local.organizationId !== identity.organizationId ||
    local.locationId !== identity.locationId ||
    local.appointmentId !== identity.appointmentId ||
    local.customerId !== identity.customerId ||
    local.staffId !== identity.staffId ||
    local.serviceId !== identity.serviceId
  ) {
    throw new Error(BROWSER_SYNC_IDENTITY_MESSAGE);
  }
}

function canonicalClinicalDraft(draft: TreatmentDraft): TreatmentDraft {
  return normalizeTreatmentDraft(draft, {
    organizationId: draft.organizationId,
    locationId: draft.locationId,
    appointmentId: draft.appointmentId,
    customerId: draft.customerId,
    staffId: draft.staffId,
    serviceId: draft.serviceId,
  });
}

/** Clinical equality after the remote row is normalized. Object key order is not content. */
export function browserClinicalFieldsMatch(local: TreatmentDraft, remote: TreatmentDraft): boolean {
  return treatmentClinicalFieldsMatch(canonicalClinicalDraft(local), remote);
}

function sameIdentity(row: TreatmentDraft, identity: BrowserCompletedSyncIdentity): boolean {
  return (
    row.organizationId === identity.organizationId &&
    row.locationId === identity.locationId &&
    row.appointmentId === identity.appointmentId &&
    row.customerId === identity.customerId &&
    row.staffId === identity.staffId &&
    row.serviceId === identity.serviceId
  );
}

function assertVerified(row: TreatmentDraft | null, local: TreatmentDraft, identity: BrowserCompletedSyncIdentity): TreatmentDraft {
  if (
    !row ||
    row.status !== "completed" ||
    !sameIdentity(row, identity) ||
    !browserClinicalFieldsMatch(local, row)
  ) {
    throw new Error(BROWSER_SYNC_VERIFY_MESSAGE);
  }
  return row;
}

export async function syncBrowserCompletedTreatment(input: {
  identity: BrowserCompletedSyncIdentity;
  local: TreatmentDraft;
  readRemote: () => Promise<TreatmentDraft | null>;
  createRemote: (local: TreatmentDraft) => Promise<TreatmentDraft>;
  completeRemote: (remote: TreatmentDraft, local: TreatmentDraft) => Promise<TreatmentDraft>;
}): Promise<TreatmentDraft> {
  assertBrowserCompletedIdentity(input.local, input.identity);
  const existing = await input.readRemote();
  if (existing) {
    if (!sameIdentity(existing, input.identity)) {
      throw new Error(BROWSER_SYNC_CONFLICT_MESSAGE);
    }
    if (existing.status === "completed") {
      return assertVerified(existing, input.local, input.identity);
    }
    if (!browserClinicalFieldsMatch(input.local, existing)) {
      throw new Error(BROWSER_SYNC_CONFLICT_MESSAGE);
    }
    await input.completeRemote(existing, input.local);
    return assertVerified(await input.readRemote(), input.local, input.identity);
  }

  let created: TreatmentDraft;
  try {
    created = await input.createRemote(input.local);
  } catch (error: unknown) {
    if (!(error instanceof TreatmentDuplicateError)) throw error;
    const raced = await input.readRemote();
    if (!raced || !sameIdentity(raced, input.identity)) {
      throw new Error(BROWSER_SYNC_CONFLICT_MESSAGE);
    }
    if (raced.status === "completed") {
      return assertVerified(raced, input.local, input.identity);
    }
    if (!browserClinicalFieldsMatch(input.local, raced)) {
      throw new Error(BROWSER_SYNC_CONFLICT_MESSAGE);
    }
    await input.completeRemote(raced, input.local);
    return assertVerified(await input.readRemote(), input.local, input.identity);
  }
  if (!sameIdentity(created, input.identity) || created.status === "completed") {
    throw new Error(BROWSER_SYNC_VERIFY_MESSAGE);
  }
  await input.completeRemote(created, input.local);
  return assertVerified(await input.readRemote(), input.local, input.identity);
}
