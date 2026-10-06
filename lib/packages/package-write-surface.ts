/**
 * Package Plans mutation surface.
 * Remote WRITE is create-only. EDIT / ACTIVE stay local-only
 * so the same flag cannot silently open fulfillment or redemption.
 */

export const PACKAGE_REMOTE_CREATE_UNAVAILABLE_REASON =
  "遠端套票方案建立尚未開放";

export const PACKAGE_REMOTE_MUTATE_UNAVAILABLE_REASON =
  "遠端套票方案目前僅能新增";

export type PackagePlanMutationSurface = {
  create: boolean;
  edit: boolean;
  toggleActive: boolean;
  reason?: string;
};

export function resolvePackagePlanMutationSurface(input: {
  canManage: boolean;
  remoteReadPilot: boolean;
  remoteWritePilot?: boolean;
}): PackagePlanMutationSurface {
  if (!input.canManage) {
    return { create: false, edit: false, toggleActive: false };
  }
  if (input.remoteWritePilot) {
    return {
      create: true,
      edit: false,
      toggleActive: false,
      reason: PACKAGE_REMOTE_MUTATE_UNAVAILABLE_REASON,
    };
  }
  if (input.remoteReadPilot) {
    return {
      create: false,
      edit: false,
      toggleActive: false,
      reason: PACKAGE_REMOTE_CREATE_UNAVAILABLE_REASON,
    };
  }
  return { create: true, edit: true, toggleActive: true };
}
