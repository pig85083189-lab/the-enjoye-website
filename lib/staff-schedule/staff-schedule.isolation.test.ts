import { beforeEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  LOC_LUMIERE_PRIMARY_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import {
  createAppointment,
  listAppointments,
  transitionAppointmentStatus,
} from "@/lib/appointments/store";
import { findAvailableStaff, getStaffAvailability } from "@/lib/staff-schedule/availability";
import {
  createBreak,
  createTimeOff,
  listBookableStaff,
  listWorkingHours,
  upsertWorkingHours,
} from "@/lib/staff-schedule/store";
import { getStaffWorkingHoursKey } from "@/lib/tenant/storage-keys";

function wipe() {
  localStorage.clear();
}

beforeEach(() => wipe());

const startAt = new Date(2026, 8, 21, 14, 0).toISOString();
const endAt = new Date(2026, 8, 21, 15, 30).toISOString();
/** Prefer staff without seed Today appointments so availability tests stay deterministic */
const CLEAN_STAFF = "staff-002";

function ensureHours(staffId = CLEAN_STAFF) {
  upsertWorkingHours(ORG_ENJOYE_ID, {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    staffId,
    dayOfWeek: 1,
    startTime: "09:00",
    endTime: "21:00",
    isWorking: true,
  });
}

function aptInput(over: Partial<Parameters<typeof createAppointment>[1]> = {}) {
  return {
    locationId: LOC_ENJOYE_PRIMARY_ID,
    customerId: "demo-001",
    serviceId: "svc-breast",
    staffId: CLEAN_STAFF,
    startAt,
    endAt,
    allowConflict: true,
    ...over,
  };
}

describe("staff schedule tenant isolation", () => {
  it("org A cannot read org B working hours", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "19:00",
      isWorking: true,
    });
    const foreign = listWorkingHours(ORG_LUMIERE_ID, {
      locationId: LOC_LUMIERE_PRIMARY_ID,
      staffId: "staff-001",
    });
    expect(foreign.every((h) => h.organizationId === ORG_LUMIERE_ID)).toBe(true);
    expect(foreign.some((h) => h.locationId === LOC_ENJOYE_PRIMARY_ID)).toBe(false);
  });

  it("org A cannot mutate org B working hours via foreign location", () => {
    expect(() =>
      upsertWorkingHours(ORG_ENJOYE_ID, {
        locationId: LOC_LUMIERE_PRIMARY_ID,
        staffId: "staff-001",
        dayOfWeek: 1,
        startTime: "10:00",
        endTime: "19:00",
        isWorking: true,
      }),
    ).toThrow(/Location/);
  });

  it("rejects foreign staff membership for location", () => {
    expect(() =>
      upsertWorkingHours(ORG_ENJOYE_ID, {
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: "staff-lumiere-01",
        dayOfWeek: 1,
        startTime: "10:00",
        endTime: "19:00",
        isWorking: true,
      }),
    ).toThrow(/Staff/);
  });

  it("same staff id across organizations does not leak hours", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "12:00",
      isWorking: true,
    });
    upsertWorkingHours(ORG_LUMIERE_ID, {
      locationId: LOC_LUMIERE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 1,
      startTime: "14:00",
      endTime: "20:00",
      isWorking: true,
    });
    const enjoye = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
    }).find((h) => h.dayOfWeek === 1);
    const lumiere = listWorkingHours(ORG_LUMIERE_ID, {
      locationId: LOC_LUMIERE_PRIMARY_ID,
      staffId: "staff-001",
    }).find((h) => h.dayOfWeek === 1);
    expect(enjoye?.startTime).toBe("10:00");
    expect(lumiere?.startTime).toBe("14:00");
  });

  it("persists schedule across store re-read", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      dayOfWeek: 2,
      startTime: "11:00",
      endTime: "18:00",
      isWorking: true,
    });
    expect(localStorage.getItem(getStaffWorkingHoursKey(ORG_ENJOYE_ID))).toBeTruthy();
    const again = listWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
    }).find((h) => h.dayOfWeek === 2);
    expect(again?.startTime).toBe("11:00");
  });

  it("day roster only includes current org/location staff", () => {
    const enjoye = listBookableStaff(ORG_ENJOYE_ID, LOC_ENJOYE_PRIMARY_ID);
    const lumiere = listBookableStaff(ORG_LUMIERE_ID, LOC_LUMIERE_PRIMARY_ID);
    expect(enjoye.every((m) => m.organizationId === ORG_ENJOYE_ID)).toBe(true);
    expect(enjoye.some((m) => m.userId === "staff-lumiere-01")).toBe(false);
    expect(lumiere.every((m) => m.organizationId === ORG_LUMIERE_ID)).toBe(true);
    expect(lumiere.some((m) => m.userId === "staff-002")).toBe(false);
  });
});

describe("availability engine", () => {
  it("is available inside working hours", () => {
    ensureHours();
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt,
        endAt,
        appointments: [],
      }).available,
    ).toBe(true);
  });

  it("is unavailable outside working hours", () => {
    upsertWorkingHours(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      dayOfWeek: 1,
      startTime: "10:00",
      endTime: "13:00",
      isWorking: true,
    });
    const result = getStaffAvailability({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      startAt,
      endAt,
      appointments: [],
    });
    expect(result.available).toBe(false);
    expect(result.reasons).toContain("OUTSIDE_WORKING_HOURS");
  });

  it("break makes slot unavailable", () => {
    ensureHours();
    createBreak(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      startAt: new Date(2026, 8, 21, 14, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 15, 0).toISOString(),
      label: "午休",
    });
    const result = getStaffAvailability({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      startAt,
      endAt,
      appointments: [],
    });
    expect(result.available).toBe(false);
    expect(result.reasons).toContain("BREAK");
  });

  it("approved time off makes slot unavailable", () => {
    ensureHours();
    createTimeOff(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      startAt: new Date(2026, 8, 21, 9, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 21, 0).toISOString(),
      reason: "休假",
      status: "APPROVED",
    });
    const result = getStaffAvailability({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      startAt,
      endAt,
      appointments: [],
    });
    expect(result.available).toBe(false);
    expect(result.reasons).toContain("TIME_OFF");
  });

  it("BOOKED overlap blocks availability", () => {
    ensureHours();
    const booked = createAppointment(ORG_ENJOYE_ID, aptInput());
    const result = getStaffAvailability({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: CLEAN_STAFF,
      startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
      appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
    });
    expect(result.reasons).toContain("APPOINTMENT_CONFLICT");
    expect(booked.status).toBe("BOOKED");
  });

  it("CONFIRMED ARRIVED IN_SERVICE overlaps block; CANCELLED and NO_SHOW do not", () => {
    ensureHours();
    const row = createAppointment(ORG_ENJOYE_ID, aptInput());
    transitionAppointmentStatus(ORG_ENJOYE_ID, row.id, "CONFIRMED");
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
      }).reasons,
    ).toContain("APPOINTMENT_CONFLICT");

    transitionAppointmentStatus(ORG_ENJOYE_ID, row.id, "ARRIVED");
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
      }).reasons,
    ).toContain("APPOINTMENT_CONFLICT");

    transitionAppointmentStatus(ORG_ENJOYE_ID, row.id, "IN_SERVICE");
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
      }).reasons,
    ).toContain("APPOINTMENT_CONFLICT");

    transitionAppointmentStatus(ORG_ENJOYE_ID, row.id, "COMPLETED");
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
      }).reasons,
    ).toContain("APPOINTMENT_CONFLICT");

    const cancelled = createAppointment(
      ORG_ENJOYE_ID,
      aptInput({
        startAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 17, 0).toISOString(),
      }),
    );
    transitionAppointmentStatus(ORG_ENJOYE_ID, cancelled.id, "CANCELLED");
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 17, 0).toISOString(),
        appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
      }).available,
    ).toBe(true);

    const missed = createAppointment(
      ORG_ENJOYE_ID,
      aptInput({
        startAt: new Date(2026, 8, 21, 17, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 18, 0).toISOString(),
      }),
    );
    transitionAppointmentStatus(ORG_ENJOYE_ID, missed.id, "NO_SHOW");
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 17, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 18, 0).toISOString(),
        appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
      }).available,
    ).toBe(true);
  });

  it("adjacent appointments do not conflict; 90-minute overlap does", () => {
    ensureHours();
    createAppointment(
      ORG_ENJOYE_ID,
      aptInput({
        startAt: new Date(2026, 8, 21, 14, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 15, 0).toISOString(),
      }),
    );
    const appts = listAppointments({ organizationId: ORG_ENJOYE_ID }).filter(
      (a) => a.staffId === CLEAN_STAFF,
    );
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 15, 0).toISOString(),
        endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        appointments: appts,
      }).available,
    ).toBe(true);
    expect(
      getStaffAvailability({
        organizationId: ORG_ENJOYE_ID,
        locationId: LOC_ENJOYE_PRIMARY_ID,
        staffId: CLEAN_STAFF,
        startAt: new Date(2026, 8, 21, 14, 30).toISOString(),
        endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
        appointments: appts,
      }).available,
    ).toBe(false);
  });

  it("findAvailableStaff returns only available staff at location", () => {
    for (const staffId of ["staff-001", "staff-002", "staff-003", "staff-004"]) {
      ensureHours(staffId);
    }
    createBreak(ORG_ENJOYE_ID, {
      locationId: LOC_ENJOYE_PRIMARY_ID,
      staffId: "staff-001",
      startAt: new Date(2026, 8, 21, 14, 0).toISOString(),
      endAt: new Date(2026, 8, 21, 16, 0).toISOString(),
      label: "休息",
    });
    const available = findAvailableStaff({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
      startAt,
      endAt,
      appointments: listAppointments({ organizationId: ORG_ENJOYE_ID }),
    });
    expect(available.some((s) => s.staffId === "staff-001")).toBe(false);
    expect(available.some((s) => s.staffId === "staff-002")).toBe(true);
    expect(available.every((s) => !s.staffId.includes("lumiere"))).toBe(true);
  });

  it("staff filter does not change underlying appointment data", () => {
    ensureHours();
    const created = createAppointment(ORG_ENJOYE_ID, aptInput());
    const all = listAppointments({
      organizationId: ORG_ENJOYE_ID,
      locationId: LOC_ENJOYE_PRIMARY_ID,
    });
    const filtered = all.filter((a) => a.staffId === "staff-003");
    expect(all.some((a) => a.id === created.id)).toBe(true);
    expect(filtered.some((a) => a.id === created.id)).toBe(false);
    expect(
      listAppointments({ organizationId: ORG_ENJOYE_ID }).some((a) => a.id === created.id),
    ).toBe(true);
  });
});
