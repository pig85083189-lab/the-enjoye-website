/**
 * Shared invalidation signal for remote Treatment read surfaces.
 * No realtime. Hooks include the revision in their request key.
 */

export const TREATMENT_REMOTE_WRITE_REFRESH_EVENT =
  "enjoye-treatment-remote-write-refresh";

export interface TreatmentRemoteWriteRefreshDetail {
  organizationId: string;
  customerId?: string;
  appointmentId?: string;
  treatmentId?: string;
}

let revision = 0;

export function getTreatmentRemoteWriteRevision(): number {
  return revision;
}

export function resetTreatmentRemoteWriteRevisionForTests(): void {
  revision = 0;
}

export function emitTreatmentRemoteWriteRefresh(
  detail: TreatmentRemoteWriteRefreshDetail,
): number {
  revision += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(TREATMENT_REMOTE_WRITE_REFRESH_EVENT, { detail }),
    );
  }
  return revision;
}

export function subscribeTreatmentRemoteWriteRefresh(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(TREATMENT_REMOTE_WRITE_REFRESH_EVENT, handler);
  return () => window.removeEventListener(TREATMENT_REMOTE_WRITE_REFRESH_EVENT, handler);
}
