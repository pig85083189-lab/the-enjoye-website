/**
 * Service Catalog mutation surface.
 * Remote writes support create, edit and active status for authorized managers.
 */

export const SERVICE_REMOTE_CREATE_UNAVAILABLE_REASON =
  "遠端服務建立尚未開放";

export const SERVICE_REMOTE_MUTATE_UNAVAILABLE_REASON =
  "遠端服務目前僅能新增";

export type ServiceCatalogMutationSurface = {
  create: boolean;
  edit: boolean;
  toggleActive: boolean;
  reason?: string;
};

export function resolveServiceCatalogMutationSurface(input: {
  canManage: boolean;
  remoteReadPilot: boolean;
  remoteWritePilot?: boolean;
}): ServiceCatalogMutationSurface {
  if (!input.canManage) {
    return { create: false, edit: false, toggleActive: false };
  }
  if (input.remoteWritePilot) {
    return {
      create: true,
      edit: true,
      toggleActive: true,
    };
  }
  if (input.remoteReadPilot) {
    return {
      create: false,
      edit: false,
      toggleActive: false,
      reason: SERVICE_REMOTE_CREATE_UNAVAILABLE_REASON,
    };
  }
  return { create: true, edit: true, toggleActive: true };
}
