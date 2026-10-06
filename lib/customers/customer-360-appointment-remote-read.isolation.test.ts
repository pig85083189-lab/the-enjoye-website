import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  deriveLastVisitLabel,
  resolveCustomer360Appointments,
} from "@/lib/customers/customer-360";
import { deriveNextAppointment } from "@/lib/customers/crm-derived";
import type { Customer } from "@/types";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

const ORG = "org-the-enjoye";
const CUST = "cust-muvb8x0p-887ltc";

function customer(): Customer {
  return {
    id: CUST,
    organizationId: ORG,
    name: "喻茗楷",
    phone: "0980929616",
    birthday: "",
    age: 0,
    membership: "new",
    lastVisit: "",
    totalVisits: 0,
    packages: [],
    lastServiceNotes: [],
    trackingFocus: [],
    alerts: [],
    tags: [],
    primaryStaffId: "staff-001",
    joinedAt: "2026/10/06",
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function remoteBooked(): ScheduleAppointment {
  return {
    id: "apt-muw55olz-h64n65",
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: CUST,
    customerName: "喻茗楷",
    serviceId: "svc-official",
    serviceName: "美波澎潤upupSPA",
    staffId: "staff-001",
    staffName: "測試帳號",
    startAt: "2026-10-06T04:00:00+00:00",
    endAt: "2026-10-06T05:00:00+00:00",
    durationMinutes: 60,
    status: "BOOKED",
    notes: [],
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

describe("Customer 360 Appointment remote-read source", () => {
  it("uses remote rows when the pilot hands an array, including empty", () => {
    const remote = [remoteBooked()];
    const local: ScheduleAppointment[] = [
      { ...remoteBooked(), id: "apt-seed", serviceName: "seed local" },
    ];
    expect(resolveCustomer360Appointments(remote, local)).toEqual(remote);
    expect(resolveCustomer360Appointments([], local)).toEqual([]);
    expect(resolveCustomer360Appointments(null, local)).toEqual(local);
    expect(resolveCustomer360Appointments(undefined, local)).toEqual(local);
  });

  it("derives next appointment from the remote BOOKED row by cust-*", () => {
    const next = deriveNextAppointment({
      customer: customer(),
      appointments: [remoteBooked()],
      now: new Date("2026-10-06T08:00:00+08:00"),
    });
    expect(next).toMatchObject({
      dateLabel: "2026/10/06",
      timeLabel: "12:00",
      serviceName: "美波澎潤upupSPA",
      staffName: "測試帳號",
    });
  });

  it("does not treat a BOOKED remote appointment as last visit", () => {
    expect(
      deriveLastVisitLabel({
        customer: customer(),
        appointments: [remoteBooked()],
        treatments: [],
      }),
    ).toBeNull();
  });

  it("does not rematch Customer 360 appointments by name or phone", () => {
    const snapshot = read("features/customers/use-customer-360.ts");
    const profile = read("features/customers/CustomerProfilePage.tsx");
    const hook = read("features/customers/use-appointment-remote-read.ts");
    expect(snapshot).toMatch(/remoteAppointments != null/);
    expect(snapshot).toMatch(/resolveCustomer360Appointments/);
    expect(snapshot).not.toMatch(/full_name|phone ===|customer\.name ===/);
    expect(profile).toMatch(/useCustomerRemoteAppointments/);
    expect(profile).toMatch(/customer\.id/);
    expect(hook).toMatch(/listRemotePilotAppointmentsByCustomer/);
    expect(hook).toMatch(/customerId/);
    expect(hook).not.toMatch(/full_name|phone/);
  });

  it("keeps Customer 360 RSC on the appointment read flag + connection()", () => {
    const page = read("app/staff/(app)/customers/[id]/page.tsx");
    expect(page).toMatch(/await connection\(\)/);
    expect(page).toMatch(/isAppointmentRemoteReadPilotEnabled/);
    expect(page).toMatch(/appointment-remote-read-flag/);
    expect(page).not.toMatch(/appointment-remote-read-pilot/);
  });
});
