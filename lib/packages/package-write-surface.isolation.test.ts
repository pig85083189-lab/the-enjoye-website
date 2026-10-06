import { describe, expect, it } from "vitest";
import {
  PACKAGE_REMOTE_CREATE_UNAVAILABLE_REASON,
  PACKAGE_REMOTE_MUTATE_UNAVAILABLE_REASON,
  resolvePackagePlanMutationSurface,
} from "./package-write-surface";

describe("Package plan mutation surface", () => {
  it("keeps local create/edit/toggle when both pilots are off", () => {
    expect(
      resolvePackagePlanMutationSurface({
        canManage: true,
        remoteReadPilot: false,
        remoteWritePilot: false,
      }),
    ).toEqual({ create: true, edit: true, toggleActive: true });
  });

  it("disables every mutation on remote read-only", () => {
    expect(
      resolvePackagePlanMutationSurface({
        canManage: true,
        remoteReadPilot: true,
        remoteWritePilot: false,
      }),
    ).toEqual({
      create: false,
      edit: false,
      toggleActive: false,
      reason: PACKAGE_REMOTE_CREATE_UNAVAILABLE_REASON,
    });
  });

  it("opens create only when remote write is on", () => {
    expect(
      resolvePackagePlanMutationSurface({
        canManage: true,
        remoteReadPilot: true,
        remoteWritePilot: true,
      }),
    ).toEqual({
      create: true,
      edit: false,
      toggleActive: false,
      reason: PACKAGE_REMOTE_MUTATE_UNAVAILABLE_REASON,
    });
  });

  it("hides create for roles that cannot manage package plans", () => {
    expect(
      resolvePackagePlanMutationSurface({
        canManage: false,
        remoteReadPilot: true,
        remoteWritePilot: true,
      }),
    ).toEqual({ create: false, edit: false, toggleActive: false });
  });
});
