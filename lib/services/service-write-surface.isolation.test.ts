import { describe, expect, it } from "vitest";
import {
  SERVICE_REMOTE_CREATE_UNAVAILABLE_REASON,
  SERVICE_REMOTE_MUTATE_UNAVAILABLE_REASON,
  resolveServiceCatalogMutationSurface,
} from "./service-write-surface";

describe("Service catalog mutation surface", () => {
  it("keeps local create/edit/toggle when both pilots are off", () => {
    expect(
      resolveServiceCatalogMutationSurface({
        canManage: true,
        remoteReadPilot: false,
        remoteWritePilot: false,
      }),
    ).toEqual({ create: true, edit: true, toggleActive: true });
  });

  it("disables every mutation on remote read-only", () => {
    expect(
      resolveServiceCatalogMutationSurface({
        canManage: true,
        remoteReadPilot: true,
        remoteWritePilot: false,
      }),
    ).toEqual({
      create: false,
      edit: false,
      toggleActive: false,
      reason: SERVICE_REMOTE_CREATE_UNAVAILABLE_REASON,
    });
  });

  it("opens create only when remote write is on", () => {
    expect(
      resolveServiceCatalogMutationSurface({
        canManage: true,
        remoteReadPilot: true,
        remoteWritePilot: true,
      }),
    ).toEqual({
      create: true,
      edit: false,
      toggleActive: false,
      reason: SERVICE_REMOTE_MUTATE_UNAVAILABLE_REASON,
    });
  });

  it("hides create for roles that cannot manage services", () => {
    expect(
      resolveServiceCatalogMutationSurface({
        canManage: false,
        remoteReadPilot: true,
        remoteWritePilot: true,
      }),
    ).toEqual({ create: false, edit: false, toggleActive: false });
  });
});
