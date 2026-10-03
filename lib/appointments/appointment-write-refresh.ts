/**
 * Shared invalidation signal for remote appointment read surfaces.
 * No realtime. Hooks include the revision in their request key.
 */

export const APPOINTMENT_REMOTE_WRITE_REFRESH_EVENT =
  "enjoye-appointment-remote-write-refresh";

export interface AppointmentRemoteWriteRefreshDetail {
  organizationId: string;
  customerId?: string;
  locationId?: string;
  startAt?: string;
}

let revision = 0;

export function getAppointmentRemoteWriteRevision(): number {
  return revision;
}

export function resetAppointmentRemoteWriteRevisionForTests(): void {
  revision = 0;
}

export function emitAppointmentRemoteWriteRefresh(
  detail: AppointmentRemoteWriteRefreshDetail,
): number {
  revision += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(APPOINTMENT_REMOTE_WRITE_REFRESH_EVENT, { detail }),
    );
  }
  return revision;
}

export function subscribeAppointmentRemoteWriteRefresh(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(APPOINTMENT_REMOTE_WRITE_REFRESH_EVENT, handler);
  return () => window.removeEventListener(APPOINTMENT_REMOTE_WRITE_REFRESH_EVENT, handler);
}
