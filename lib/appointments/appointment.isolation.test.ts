import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  assertTransition,
  canTransition,
  hasAppointmentConflict,
  normalizeAppointmentStatus,
  rangesOverlap,
  type ScheduleAppointment,
} from "@/lib/appointments/domain";
import {
  createAppointment,
  getScheduleAppointment,
  listAppointments,
  listTodayAppointments,
  transitionAppointmentStatus,
  updateAppointment,
} from "@/lib/appointments/store";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

function baseInput(over: Partial<Parameters<typeof createAppointment>[1]> = {}) {
  const start = new Date(2026, 8, 21, 14, 0, 0);
  const end = new Date(2026, 8, 21, 15, 30, 0);
  return {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId: "staff-001",
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    allowConflict: true,
    ...over,
  };
}

describe("status normalization and transitions", () => {
  it("normalizes legacy statuses", () => {
    expect(normalizeAppointmentStatus("pending")).toBe("BOOKED");
    expect(normalizeAppointmentStatus("in_progress")).toBe("IN_SERVICE");
    expect(normalizeAppointmentStatus("completed")).toBe("COMPLETED");
  });

  it("allows valid and rejects invalid transitions", () => {
    expect(canTransition("BOOKED", "CONFIRMED")).toBe(true);
    expect(canTransition("CONFIRMED", "ARRIVED")).toBe(true);
    expect(canTransition("ARRIVED", "IN_SERVICE")).toBe(true);
    expect(canTransition("IN_SERVICE", "COMPLETED")).toBe(true);
    expect(canTransition("COMPLETED", "BOOKED")).toBe(false);
    expect(canTransition("CANCELLED", "IN_SERVICE")).toBe(false);
    expect(canTransition("NO_SHOW", "COMPLETED")).toBe(false);
    expect(() => assertTransition("COMPLETED", "BOOKED")).toThrow(/Invalid/);
  });
});

describe("time overlap", () => {
  it("detects overlap and allows adjacent", () => {
    const a0 = new Date(2026, 8, 21, 14, 0).toISOString();
    const a1 = new Date(2026, 8, 21, 15, 30).toISOString();
    const b0 = new Date(2026, 8, 21, 15, 0).toISOString();
    const b1 = new Date(2026, 8, 21, 16, 0).toISOString();
    const c0 = new Date(2026, 8, 21, 15, 0).toISOString();
    const c1 = new Date(2026, 8, 21, 16, 0).toISOString();
    expect(rangesOverlap(a0, a1, b0, b1)).toBe(true);
    expect(rangesOverlap(a0, new Date(2026, 8, 21, 15, 0).toISOString(), c0, c1)).toBe(false);

    const existing = [
      {
        id: "a",
        staffId: "staff-001",
        startAt: a0,
        endAt: a1,
        status: "BOOKED",
      },
    ] as ScheduleAppointment[];
    expect(
      hasAppointmentConflict(
        { id: "b", staffId: "staff-001", startAt: b0, endAt: b1, status: "BOOKED" },
        existing,
      ),
    ).toBeTruthy();
    expect(
      hasAppointmentConflict(
        {
          id: "c",
          staffId: "staff-001",
          startAt: new Date(2026, 8, 21, 15, 30).toISOString(),
          endAt: new Date(2026, 8, 21, 16, 30).toISOString(),
          status: "BOOKED",
        },
        existing,
      ),
    ).toBeUndefined();
  });
});

describe("appointment store isolation", () => {
  it("rejects cross-tenant reads and writes", () => {
    const created = createAppointment(ORG_ENJOYE_ID, baseInput());
    expect(getScheduleAppointment(ORG_LUMIERE_ID, created.id)).toBeUndefined();
    expect(() =>
      updateAppointment(ORG_LUMIERE_ID, created.id, { customerNote: "hack" }),
    ).toThrow(/not found/i);
  });

  it("rejects foreign location, customer, service, staff", () => {
    expect(() =>
      createAppointment(ORG_ENJOYE_ID, baseInput({ locationId: LOC_LUMIERE_PRIMARY_ID })),
    ).toThrow(/Location/);
    expect(() =>
      createAppointment(ORG_ENJOYE_ID, baseInput({ customerId: "lumiere-c-001" })),
    ).toThrow(/Customer/);
    expect(() =>
      createAppointment(ORG_ENJOYE_ID, baseInput({ serviceId: "svc-lumiere-facial" })),
    ).toThrow(/Service/);
    expect(() =>
      createAppointment(ORG_ENJOYE_ID, baseInput({ staffId: "staff-lumiere-01" })),
    ).toThrow(/Staff/);
  });

  it("filters by org, location, date, customer, status", () => {
    const created = createAppointment(ORG_ENJOYE_ID, baseInput());
    const day = new Date(2026, 8, 21);
    expect(listAppointments({ organizationId: ORG_ENJOYE_ID }).some((a) => a.id === created.id)).toBe(true);
    expect(
      listAppointments({ organizationId: ORG_ENJOYE_ID, locationId: LOC_LUMIERE_PRIMARY_ID }).some(
        (a) => a.id === created.id,
      ),
    ).toBe(false);
    expect(
      listAppointments({
        organizationId: ORG_ENJOYE_ID,
        customerId: "demo-001",
      }).some((a) => a.id === created.id),
    ).toBe(true);
    expect(
      listAppointments({ organizationId: ORG_ENJOYE_ID, status: "BOOKED" }).some(
        (a) => a.id === created.id,
      ),
    ).toBe(true);
    expect(
      listAppointments({
        organizationId: ORG_ENJOYE_ID,
        from: new Date(2026, 8, 21, 0, 0),
        to: new Date(2026, 8, 21, 23, 59),
      }).some((a) => a.id === created.id),
    ).toBe(true);
    expect(
      listAppointments({
        organizationId: ORG_ENJOYE_ID,
        from: new Date(2026, 8, 22, 0, 0),
        to: new Date(2026, 8, 22, 23, 59),
      }).some((a) => a.id === created.id),
    ).toBe(false);
    expect(listTodayAppointments(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID, day).some((a) => a.id === created.id)).toBe(
      true,
    );
    expect(listTodayAppointments(ORG_LUMIERE_ID, LOC_LUMIERE_PRIMARY_ID, day).some((a) => a.id === created.id)).toBe(
      false,
    );
  });

  it("supports valid lifecycle transitions on persisted rows", () => {
    const created = createAppointment(ORG_ENJOYE_ID, baseInput());
    expect(transitionAppointmentStatus(ORG_ENJOYE_ID, created.id, "CONFIRMED").status).toBe("CONFIRMED");
    expect(transitionAppointmentStatus(ORG_ENJOYE_ID, created.id, "ARRIVED").status).toBe("ARRIVED");
    expect(transitionAppointmentStatus(ORG_ENJOYE_ID, created.id, "IN_SERVICE").status).toBe("IN_SERVICE");
    expect(transitionAppointmentStatus(ORG_ENJOYE_ID, created.id, "COMPLETED").status).toBe("COMPLETED");
    expect(() => transitionAppointmentStatus(ORG_ENJOYE_ID, created.id, "BOOKED")).toThrow(/Invalid/);
  });

  it("persists create, update, cancel, no-show", () => {
    const created = createAppointment(ORG_ENJOYE_ID, baseInput({ allowConflict: true }));
    const updated = updateAppointment(ORG_ENJOYE_ID, created.id, {
      customerNote: "備註",
      allowConflict: true,
    });
    expect(updated.customerNote).toBe("備註");
    const cancelled = transitionAppointmentStatus(ORG_ENJOYE_ID, created.id, "CANCELLED");
    expect(cancelled.status).toBe("CANCELLED");
    expect(getScheduleAppointment(ORG_ENJOYE_ID, created.id)?.status).toBe("CANCELLED");

    const other = createAppointment(
      ORG_ENJOYE_ID,
      baseInput({
        startAt: new Date(2026, 8, 22, 10, 0).toISOString(),
        endAt: new Date(2026, 8, 22, 11, 0).toISOString(),
      }),
    );
    const missed = transitionAppointmentStatus(ORG_ENJOYE_ID, other.id, "NO_SHOW");
    expect(missed.status).toBe("NO_SHOW");
    expect(getScheduleAppointment(ORG_ENJOYE_ID, other.id)?.status).toBe("NO_SHOW");
  });

  it("rejects endAt before startAt", () => {
    const start = new Date(2026, 8, 21, 16, 0).toISOString();
    const end = new Date(2026, 8, 21, 15, 0).toISOString();
    expect(() => createAppointment(ORG_ENJOYE_ID, baseInput({ startAt: start, endAt: end }))).toThrow(
      /endAt/,
    );
  });

  it("requires explicit override when staff times overlap", () => {
    createAppointment(ORG_ENJOYE_ID, baseInput({ allowConflict: true }));
    expect(() =>
      createAppointment(
        ORG_ENJOYE_ID,
        baseInput({
          allowConflict: false,
          startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
          endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        }),
      ),
    ).toThrow(/CONFLICT/);
  });

  it("does not leak same id across organizations", () => {
    const shared = "apt-shared-001";
    localStorage.setItem(
      `beauty-os:${ORG_ENJOYE_ID}:schedule-appointments:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_ENJOYE_ID,
          locationId: LOC_ENJOYE_PRIMARY_ID,
          customerId: "demo-001",
          customerName: "A",
          serviceId: "svc-breast",
          serviceName: "美胸",
          staffId: "staff-001",
          staffName: "怡蓁",
          startAt: new Date(2026, 8, 21, 9, 0).toISOString(),
          endAt: new Date(2026, 8, 21, 10, 0).toISOString(),
          durationMinutes: 60,
          status: "BOOKED",
          notes: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    localStorage.setItem(
      `beauty-os:${ORG_LUMIERE_ID}:schedule-appointments:v1`,
      JSON.stringify([
        {
          id: shared,
          organizationId: ORG_LUMIERE_ID,
          locationId: LOC_LUMIERE_PRIMARY_ID,
          customerId: "lumiere-c-001",
          customerName: "B",
          serviceId: "svc-lumiere-facial",
          serviceName: "臉",
          staffId: "staff-001",
          staffName: "怡蓁",
          startAt: new Date(2026, 8, 21, 9, 0).toISOString(),
          endAt: new Date(2026, 8, 21, 10, 0).toISOString(),
          durationMinutes: 60,
          status: "BOOKED",
          notes: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ]),
    );
    expect(getScheduleAppointment(ORG_ENJOYE_ID, shared)?.customerName).toBe("A");
    expect(getScheduleAppointment(ORG_LUMIERE_ID, shared)?.customerName).toBe("B");
  });
});
