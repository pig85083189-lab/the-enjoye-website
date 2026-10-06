/**
 * Shared invalidation signal for remote Package catalog reads.
 * No realtime. Hooks include the revision in their request key.
 */

export const PACKAGE_REMOTE_WRITE_REFRESH_EVENT =
  "enjoye-package-remote-write-refresh";

export interface PackageRemoteWriteRefreshDetail {
  organizationId: string;
  packageDefinitionId?: string;
}

let revision = 0;

export function getPackageRemoteWriteRevision(): number {
  return revision;
}

export function resetPackageRemoteWriteRevisionForTests(): void {
  revision = 0;
}

export function emitPackageRemoteWriteRefresh(
  detail: PackageRemoteWriteRefreshDetail,
): number {
  revision += 1;
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent(PACKAGE_REMOTE_WRITE_REFRESH_EVENT, { detail }),
    );
  }
  return revision;
}

export function subscribePackageRemoteWriteRefresh(
  onChange: () => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const handler = () => onChange();
  window.addEventListener(PACKAGE_REMOTE_WRITE_REFRESH_EVENT, handler);
  return () => window.removeEventListener(PACKAGE_REMOTE_WRITE_REFRESH_EVENT, handler);
}
