/**
 * Shared invalidation signal for remote Service Catalog reads.
 * No realtime. Hooks include the revision in their request key.
 */

export const SERVICE_REMOTE_WRITE_REFRESH_EVENT =
  "enjoye-service-remote-write-refresh";

export interface ServiceRemoteWriteRefreshDetail {
  organizationId: string;
  serviceId?: string;
}

let revision = 0;

export function getServiceRemoteWriteRevision(): number {
  return revision;
}

export function resetServiceRemoteWriteRevisionForTests(): void {
  revision = 0;
}

export function emitServiceRemoteWriteRefresh(
  detail: ServiceRemoteWriteRefreshDetail,
): number {
  revision += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(SERVICE_REMOTE_WRITE_REFRESH_EVENT, { detail }),
    );
  }
  return revision;
}

export function subscribeServiceRemoteWriteRefresh(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(SERVICE_REMOTE_WRITE_REFRESH_EVENT, handler);
  return () => window.removeEventListener(SERVICE_REMOTE_WRITE_REFRESH_EVENT, handler);
}
