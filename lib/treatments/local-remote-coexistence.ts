/**
 * Read-only union of browser treatments and Supabase treatments.
 * A row is repeated only when its organization, treatment id, appointment,
 * and customer do not all agree. Clinical differences stay side by side.
 * Names and phones are never match keys. Nothing is written.
 */

export interface TreatmentCoexistenceRecord {
  id: string;
  organizationId: string;
  locationId?: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  status: string;
  assessment?: unknown;
  bodyMarkers?: unknown;
  bodyMapNote?: string;
  professionalNote?: string;
  clientFeeling?: string;
  discomfortNote?: string;
  followUp?: unknown;
  suggestedTrackingAreas?: unknown;
}

export interface TreatmentLocalRemoteConflict<T> {
  local: T;
  remote: T;
  reason: "identity" | "content";
}

export interface TreatmentLocalRemoteCoexistence<T> {
  records: T[];
  conflicts: TreatmentLocalRemoteConflict<T>[];
  remoteIncluded: boolean;
}

export function combineLocalAndRemoteTreatments<T extends TreatmentCoexistenceRecord>(input: {
  remoteReadEnabled: boolean;
  remoteReady: boolean;
  localTreatments: readonly T[];
  remoteTreatments: readonly T[];
}): TreatmentLocalRemoteCoexistence<T> {
  if (!input.remoteReadEnabled || !input.remoteReady) {
    return {
      records: [...input.localTreatments],
      conflicts: [],
      remoteIncluded: false,
    };
  }

  const remoteById = new Map<string, T>();
  const remoteByAppointment = new Map<string, T>();
  for (const remote of input.remoteTreatments) {
    remoteById.set(treatmentIdentityKey(remote), remote);
    if (remote.appointmentId) {
      remoteByAppointment.set(appointmentKey(remote), remote);
    }
  }

  const conflicts: TreatmentLocalRemoteConflict<T>[] = [];
  const localOnly: T[] = [];
  for (const local of input.localTreatments) {
    const sameId = remoteById.get(treatmentIdentityKey(local));
    if (sameId) {
      if (sameTreatmentRecord(local, sameId)) continue;
      conflicts.push({ local, remote: sameId, reason: conflictingIdentity(local, sameId) ? "identity" : "content" });
      localOnly.push(local);
      continue;
    }
    const sameAppointment = local.appointmentId
      ? remoteByAppointment.get(appointmentKey(local))
      : undefined;
    if (sameAppointment) {
      conflicts.push({ local, remote: sameAppointment, reason: "identity" });
      localOnly.push(local);
      continue;
    }
    localOnly.push(local);
  }

  return {
    records: [...input.remoteTreatments, ...localOnly],
    conflicts,
    remoteIncluded: true,
  };
}

export function remoteTreatmentWriteStoppedByStoredLocal(
  next: TreatmentCoexistenceRecord,
  stored: readonly TreatmentCoexistenceRecord[],
): boolean {
  const sameId = stored.find((item) =>
    item.organizationId === next.organizationId && item.id === next.id);
  return Boolean(sameId && !sameTreatmentRecord(sameId, next));
}

function treatmentIdentityKey(treatment: TreatmentCoexistenceRecord): string {
  return `${treatment.organizationId}\0${treatment.id}`;
}

function appointmentKey(treatment: TreatmentCoexistenceRecord): string {
  return `${treatment.organizationId}\0${treatment.appointmentId}`;
}

function conflictingIdentity(
  local: TreatmentCoexistenceRecord,
  remote: TreatmentCoexistenceRecord,
): boolean {
  return local.customerId !== remote.customerId
    || local.appointmentId !== remote.appointmentId
    || local.organizationId !== remote.organizationId;
}

function sameTreatmentRecord(
  local: TreatmentCoexistenceRecord,
  remote: TreatmentCoexistenceRecord,
): boolean {
  return !conflictingIdentity(local, remote)
    && local.locationId === remote.locationId
    && local.staffId === remote.staffId
    && local.serviceId === remote.serviceId
    && local.status === remote.status
    && clinicalText(local) === clinicalText(remote);
}

function clinicalText(treatment: TreatmentCoexistenceRecord): string {
  return stableStringify({
    assessment: treatment.assessment ?? null,
    bodyMarkers: treatment.bodyMarkers ?? null,
    bodyMapNote: treatment.bodyMapNote ?? "",
    professionalNote: treatment.professionalNote ?? "",
    clientFeeling: treatment.clientFeeling ?? "",
    discomfortNote: treatment.discomfortNote ?? "",
    followUp: treatment.followUp ?? null,
    suggestedTrackingAreas: treatment.suggestedTrackingAreas ?? null,
  });
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
