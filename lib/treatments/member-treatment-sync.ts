/**
 * Copy one completed booking treatment onto the finance project the member site reads.
 * Identity is an existing non-revoked booking/finance link plus one verified LINE subject.
 * Names and phone numbers are not inputs. A retry inserts nothing when the same
 * treatment, member, and snapshot are already stored.
 */

import {
  commitAutomaticPublication,
  publicationSnapshotsMatch,
  type ExistingPublication,
} from "@/lib/treatments/member-publication-guard";

export type FinanceIdentityEvidence = {
  financeCustomerId: string;
  confirmationStatus: string | null;
  customerStatus: string | null;
  verifiedLineSubjects: number;
};

export type MirrorRecord = {
  treatment_id: string;
  organization_id: string;
  customer_id: string;
  booking_customer_id: string;
  status: string;
  completed_at: string;
  service_name: string | null;
  staff_name: string | null;
  assessment: unknown;
  body_markers: unknown;
  body_map_note: string | null;
  professional_note: string | null;
  client_feeling: string | null;
  discomfort_note: string | null;
  follow_up: unknown;
  products: unknown;
  suggested_tracking_areas: unknown;
};

export const MEMBER_IDENTITY_UNVERIFIED =
  "療程已儲存，但無法確認這位顧客的 LINE 會員身分，未公開給任何會員。";
export const MIRROR_OWNER_CONFLICT =
  "療程已完成，但會員同步紀錄屬於其他顧客，已停止，未另建療程。";
export const MIRROR_MISMATCH =
  "療程已完成，但既有會員同步紀錄與最新內容不一致，請聯絡管理員確認，勿重複建立療程。";
export const MIRROR_FAILED =
  "療程已儲存，但會員療程同步失敗。請再次按完成療程補同步，勿另建療程。";

/** Exactly one confirmed, active, LINE-verified finance customer. Otherwise nobody receives the record. */
export function financeMemberFromEvidence(rows: FinanceIdentityEvidence[]): { customerId: string } | null {
  if (rows.length !== 1) return null;
  const row = rows[0];
  if (!row.financeCustomerId) return null;
  if (row.confirmationStatus !== "CONFIRMED") return null;
  if (row.customerStatus !== "ACTIVE") return null;
  if (row.verifiedLineSubjects !== 1) return null;
  return { customerId: row.financeCustomerId };
}

function mirrorSnapshot(record: MirrorRecord): Record<string, unknown> {
  return {
    treatment_id: record.treatment_id,
    organization_id: record.organization_id,
    customer_id: record.customer_id,
    booking_customer_id: record.booking_customer_id,
    status: record.status,
    completed_at: record.completed_at,
    service_name: record.service_name,
    staff_name: record.staff_name,
    assessment: record.assessment,
    body_markers: record.body_markers,
    body_map_note: record.body_map_note,
    professional_note: record.professional_note,
    client_feeling: record.client_feeling,
    discomfort_note: record.discomfort_note,
    follow_up: record.follow_up,
    products: record.products,
    suggested_tracking_areas: record.suggested_tracking_areas,
  };
}

export function mirrorRecordsMatch(existing: MirrorRecord, expected: MirrorRecord): boolean {
  return publicationSnapshotsMatch(mirrorSnapshot(existing), mirrorSnapshot(expected));
}

/**
 * Insert the finance mirror once, then insert the member publication once.
 * A unique conflict is re-read. A different customer or a different snapshot stops the sync.
 */
export async function commitMemberTreatmentCopy(input: {
  mirror: MirrorRecord;
  fields: Record<string, unknown>;
  readMirror: () => Promise<MirrorRecord | null>;
  insertMirror: () => Promise<"ok" | "conflict" | "error">;
  readPublication: () => Promise<ExistingPublication>;
  insertPublication: () => Promise<"ok" | "conflict" | "error">;
}): Promise<"inserted" | "already"> {
  const expected = input.mirror;
  if (expected.status !== "COMPLETED" || !expected.completed_at || !expected.treatment_id) {
    throw new Error(MIRROR_FAILED);
  }
  if (!expected.customer_id.trim() || !expected.booking_customer_id.trim()) {
    throw new Error(MEMBER_IDENTITY_UNVERIFIED);
  }
  const current = await input.readMirror();
  if (current && current.customer_id !== expected.customer_id) throw new Error(MIRROR_OWNER_CONFLICT);
  if (current && current.treatment_id !== expected.treatment_id) throw new Error(MIRROR_OWNER_CONFLICT);
  if (current && !mirrorRecordsMatch(current, expected)) throw new Error(MIRROR_MISMATCH);
  let insertedMirror = false;
  if (!current) {
    const wrote = await input.insertMirror();
    if (wrote === "error") throw new Error(MIRROR_FAILED);
    insertedMirror = wrote === "ok";
    const verified = await input.readMirror();
    if (!verified || verified.customer_id !== expected.customer_id || !mirrorRecordsMatch(verified, expected)) {
      throw new Error(MIRROR_FAILED);
    }
  }
  const publication = await commitAutomaticPublication({
    customerId: expected.customer_id,
    fields: input.fields,
    read: input.readPublication,
    insert: input.insertPublication,
  });
  return insertedMirror || publication === "inserted" ? "inserted" : "already";
}
