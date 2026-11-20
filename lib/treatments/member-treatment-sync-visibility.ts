/**
 * Isolated stand-in for the member reader's identity filter.
 * A record is visible only when the finance mirror and the publication
 * share the verified member's customer id and organization.
 */

export type VisibleMemberRecord = {
  id: string;
  serviceName: string | null;
  staffName: string | null;
  professionalNote: string | null;
  clientFeeling: string | null;
  bodyMapNote: string | null;
  discomfortNote: string | null;
  assessment: { label: string; value: string }[];
  markers: { area: string; note: string | null }[];
  photos: { src: string; side: "left" | "right" | null }[];
};

type Mirror = {
  treatment_id: string;
  organization_id: string;
  customer_id: string;
  status: string;
  completed_at: string;
  service_name: string | null;
  staff_name: string | null;
  professional_note: string | null;
  client_feeling: string | null;
  body_map_note: string | null;
  discomfort_note: string | null;
};

type Publication = {
  treatment_id: string;
  customer_id: string;
  approved_fields: unknown;
  revoked_at: string | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function answers(value: unknown): { label: string; value: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asObject(item);
    return typeof row.label === "string" && typeof row.value === "string" ? [{ label: row.label, value: row.value }] : [];
  });
}

function markers(value: unknown): { area: string; note: string | null }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    const row = asObject(item);
    return typeof row.area === "string" ? [{ area: row.area, note: typeof row.note === "string" ? row.note : null }] : [];
  });
}

function photos(value: unknown): VisibleMemberRecord["photos"] {
  if (!Array.isArray(value)) return [];
  const rows: VisibleMemberRecord["photos"] = [];
  for (const item of value) {
    const row = asObject(item);
    if (typeof row.src !== "string" || !row.src.startsWith("https://") || row.src.includes("?") || row.src.includes("#")) continue;
    const side = row.side === "left" || row.side === "right" ? row.side : null;
    rows.push({ src: row.src, side });
  }
  return rows.sort((a, b) => (a.side === "left" ? 0 : 1) - (b.side === "left" ? 0 : 1));
}

export function memberBodyRecordVisible(input: {
  organizationId: string;
  customerId: string;
  mirrors: Mirror[];
  publications: Publication[];
}): VisibleMemberRecord[] {
  const records: VisibleMemberRecord[] = [];
  for (const publication of input.publications) {
    if (publication.revoked_at || publication.customer_id !== input.customerId) continue;
    const mirror = input.mirrors.find((row) =>
      row.treatment_id === publication.treatment_id
      && row.organization_id === input.organizationId
      && row.customer_id === input.customerId
      && row.status === "COMPLETED"
      && row.completed_at,
    );
    if (!mirror) continue;
    const approved = asObject(publication.approved_fields);
    records.push({
      id: mirror.treatment_id,
      serviceName: typeof approved.service_name === "string" ? approved.service_name : mirror.service_name,
      staffName: typeof approved.staff_name === "string" ? approved.staff_name : mirror.staff_name,
      professionalNote: mirror.professional_note,
      clientFeeling: mirror.client_feeling,
      bodyMapNote: mirror.body_map_note,
      discomfortNote: mirror.discomfort_note,
      assessment: answers(approved.consultation_answers),
      markers: markers(approved.body_marker_details),
      photos: photos(approved.photos),
    });
  }
  return records;
}
