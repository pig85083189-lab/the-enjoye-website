import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ORG_ENJOYE_ID } from "@/lib/tenant/constants";
import { getScheduleAppointmentsKey } from "@/lib/tenant/storage-keys";
import {
  combineLocalAndRemoteAppointments,
  identityConflictForId,
  persistedLocalAppointmentOverlap,
  remoteCheckoutBlockedByLocalAppointment,
  type AppointmentCoexistenceRecord,
} from "./local-remote-coexistence";
import { listPersistedScheduleAppointments } from "./store";

const ORG = "org-the-enjoye";

function appointment(overrides: Partial<AppointmentCoexistenceRecord> = {}): AppointmentCoexistenceRecord {
  return {
    id: "apt-local-001",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: "cust-line-1",
    staffId: "staff-001",
    serviceId: "svc-upup",
    startAt: "2026-11-19T02:00:00.000Z",
    endAt: "2026-11-19T03:00:00.000Z",
    status: "BOOKED",
    ...overrides,
  };
}

describe("local and remote appointments coexist", () => {
  it("keeps a stored appointment visible when remote read is on", () => {
    const local = appointment();
    const remote = appointment({ id: "apt-remote-001", customerId: "cust-line-2", startAt: "2026-11-20T02:00:00.000Z", endAt: "2026-11-20T03:00:00.000Z" });
    const result = combineLocalAndRemoteAppointments({
      remoteReadEnabled: true,
      remoteReady: true,
      localAppointments: [local],
      remoteAppointments: [remote],
    });
    expect(result.records.map((item) => item.id)).toEqual(["apt-remote-001", "apt-local-001"]);
    expect(result.conflicts).toEqual([]);
    expect(result.remoteIncluded).toBe(true);
  });

  it("shows one row when organization and appointment identity match", () => {
    const local = appointment();
    const remote = appointment();
    const result = combineLocalAndRemoteAppointments({
      remoteReadEnabled: true,
      remoteReady: true,
      localAppointments: [local],
      remoteAppointments: [remote],
    });
    expect(result.records).toEqual([remote]);
    expect(result.conflicts).toEqual([]);
  });

  it("does not merge different customers or different appointment ids", () => {
    const local = appointment();
    const remote = appointment({
      id: "apt-other",
      customerId: "cust-other",
      startAt: local.startAt,
      endAt: local.endAt,
    });
    const result = combineLocalAndRemoteAppointments({
      remoteReadEnabled: true,
      remoteReady: true,
      localAppointments: [local],
      remoteAppointments: [remote],
    });
    expect(result.records).toHaveLength(2);
    expect(result.conflicts).toEqual([]);
    expect(readFileSync("lib/appointments/local-remote-coexistence.ts", "utf8"))
      .not.toMatch(/customerName|guestContactPhone|\.phone/);
  });

  it("keeps both rows when the same appointment id belongs to different customers", () => {
    const local = appointment({ customerId: "cust-local" });
    const remote = appointment({ customerId: "cust-remote" });
    const result = combineLocalAndRemoteAppointments({
      remoteReadEnabled: true,
      remoteReady: true,
      localAppointments: [local],
      remoteAppointments: [remote],
    });
    expect(result.records.map((item) => item.customerId)).toEqual(["cust-remote", "cust-local"]);
    expect(result.conflicts).toHaveLength(1);
  });

  it("keeps stored appointments and does not mark remote data complete when the read fails", () => {
    const local = appointment();
    const before = JSON.stringify(local);
    const result = combineLocalAndRemoteAppointments({
      remoteReadEnabled: true,
      remoteReady: false,
      localAppointments: [local],
      remoteAppointments: [],
    });
    expect(result.records).toEqual([local]);
    expect(result.remoteIncluded).toBe(false);
    expect(JSON.stringify(local)).toBe(before);
    const page = readFileSync("features/calendar/CalendarPage.tsx", "utf8");
    expect(page).toContain("CalendarRemoteReadErrorFallback");
    expect(page).not.toMatch(/calendarRemoteReadPilot\s*\?\s*\[\]/);
  });

  it("reads persisted appointments without adding demo seeds or writing storage", () => {
    const key = getScheduleAppointmentsKey(ORG_ENJOYE_ID);
    const stored = appointment({ id: "apt-browser-only", organizationId: ORG_ENJOYE_ID });
    localStorage.setItem(key, JSON.stringify([stored]));
    const before = localStorage.getItem(key);
    const rows = listPersistedScheduleAppointments({ organizationId: ORG_ENJOYE_ID });
    expect(rows.map((item) => item.id)).toEqual(["apt-browser-only"]);
    expect(rows.some((item) => item.id === "apt-001")).toBe(false);
    expect(localStorage.getItem(key)).toBe(before);
  });
});

describe("local appointments can still collide on the server", () => {
  it("stops a same-browser remote create that overlaps an unsynced local appointment", () => {
    const local = appointment({ staffId: "staff-001", status: "BOOKED" });
    const hit = persistedLocalAppointmentOverlap({
      staffId: "staff-001",
      startAt: local.startAt,
      endAt: local.endAt,
      localAppointments: [local],
    });
    expect(hit?.id).toBe(local.id);
    expect(persistedLocalAppointmentOverlap({
      staffId: "staff-002",
      startAt: local.startAt,
      endAt: local.endAt,
      localAppointments: [local],
    })).toBeUndefined();
  });

  it("does not let the server overlap check see browser appointments", () => {
    const source = readFileSync("lib/appointments/appointment-write-create.ts", "utf8");
    const check = source.slice(source.indexOf("const existing"), source.indexOf("if (overlap)"));
    expect(check).toContain("persistence.appointments.list");
    expect(check).not.toMatch(/localStorage|listPersistedScheduleAppointments/);
  });

  it("stops cancel and checkout when the same appointment id belongs to different customers", () => {
    const local = appointment({ customerId: "cust-local" });
    const remote = appointment({ customerId: "cust-remote" });
    const merged = combineLocalAndRemoteAppointments({
      remoteReadEnabled: true,
      remoteReady: true,
      localAppointments: [local],
      remoteAppointments: [remote],
    });
    expect(identityConflictForId(merged.conflicts, local.id)?.local.customerId).toBe("cust-local");
    expect(remoteCheckoutBlockedByLocalAppointment({
      localAppointment: local,
      remoteCustomerId: remote.customerId,
      remoteLocationId: remote.locationId,
      remoteStaffId: remote.staffId,
      remoteServiceId: remote.serviceId,
      remoteStartAt: remote.startAt,
    })).toBe(true);
    expect(remoteCheckoutBlockedByLocalAppointment({
      localAppointment: null,
      remoteCustomerId: remote.customerId,
      remoteLocationId: remote.locationId,
      remoteStaffId: remote.staffId,
      remoteServiceId: remote.serviceId,
      remoteStartAt: remote.startAt,
    })).toBe(false);
    const page = readFileSync("features/calendar/CalendarPage.tsx", "utf8");
    const cancel = page.slice(page.indexOf("onConfirm={async () => {"));
    expect(cancel.indexOf("identityConflictForId")).toBeLessThan(cancel.indexOf("submitCalendarRemoteAppointmentCancel"));
    expect(readFileSync("features/checkout/CheckoutPageClient.tsx", "utf8")).toContain("checkoutBlocked");
  });
});

describe("remote appointment create does not fall back to the browser", () => {
  it("keeps the remote error path ahead of local create", () => {
    const page = readFileSync("features/calendar/CalendarPage.tsx", "utf8");
    const handler = page.slice(page.indexOf("async function save"));
    const remoteError = handler.indexOf("if (result === \"error\")");
    const localCreate = handler.indexOf("createAppointment(");
    expect(remoteError).toBeGreaterThan(-1);
    expect(localCreate).toBeGreaterThan(remoteError);
    expect(handler.slice(remoteError, localCreate)).toContain("return;");
    expect(readFileSync("lib/appointments/appointment-write-surface.ts", "utf8"))
      .toContain("localCreate: false");
  });
});
