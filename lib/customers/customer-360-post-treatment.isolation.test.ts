import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  deriveCustomerTimeline,
  deriveFrequentServices,
  deriveLastVisitLabel,
  derivePrimaryServiceName,
} from "@/lib/customers/customer-360";
import { deriveNextAppointment } from "@/lib/customers/crm-derived";
import { presentAppointmentStatusFromTreatment } from "@/lib/treatments/treatment-today";
import { createEmptyDraft } from "@/lib/treatment-draft";
import type { Customer, Service } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";

const ROOT = process.cwd();
const ORG = "org-the-enjoye";
const CUST = "cust-muvb8x0p-887ltc";
const APT = "apt-muw55olz-h64n65";
const SVC = "svc-muw54el4-7omtyn";
const SERVICE_NAME = "美波澎潤upupSPA";

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

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
    primaryStaffName: "測試帳號",
    joinedAt: "2026/10/06",
    createdAt: "2026-10-06T00:00:00.000Z",
    updatedAt: "2026-10-06T00:00:00.000Z",
  };
}

function remoteBooked(): ScheduleAppointment {
  return {
    id: APT,
    organizationId: ORG,
    locationId: "loc-enjoye-main",
    customerId: CUST,
    customerName: "喻茗楷",
    serviceId: SVC,
    serviceName: SERVICE_NAME,
    staffId: "staff-001",
    staffName: "測試帳號",
    startAt: "2026-10-06T04:00:00+00:00",
    endAt: "2026-10-06T05:00:00+00:00",
    durationMinutes: 60,
    status: "BOOKED",
    notes: [],
    createdAt: "2026-10-06T03:51:08.642Z",
    updatedAt: "2026-10-06T03:51:08.642Z",
  };
}

function completedTreatment(): TreatmentDraft {
  return {
    ...createEmptyDraft({
      organizationId: ORG,
      appointmentId: APT,
      customerId: CUST,
      staffId: "staff-001",
      serviceId: SVC,
    }),
    id: "trt-official",
    status: "completed",
    updatedAt: "2026-10-06T04:40:00+00:00",
    assessment: {
      concerns: ["水腫"],
      clientFocus: "",
      sensitivityLevel: 1,
    },
  };
}

const catalog: Service[] = [
  {
    id: SVC,
    organizationId: ORG,
    name: SERVICE_NAME,
    durationMinutes: 60,
    category: "美胸",
    serviceType: "BREAST",
    priceMinor: 0,
  },
];

describe("Post-treatment Customer 360 consistency", () => {
  it("resolves 主要療程 / 常用服務 from canonical catalog, never svc-*", () => {
    const frequent = deriveFrequentServices({
      treatments: [completedTreatment()],
      appointments: [remoteBooked()],
      catalog,
    });
    expect(frequent[0]?.serviceId).toBe(SVC);
    expect(frequent[0]?.serviceName).toBe(SERVICE_NAME);
    expect(frequent[0]?.serviceName).not.toMatch(/^svc-/);
    expect(derivePrimaryServiceName(frequent, customer())).toBe(SERVICE_NAME);
  });

  it("falls back to appointment serviceName when catalog is empty, still never svc-*", () => {
    const frequent = deriveFrequentServices({
      treatments: [completedTreatment()],
      appointments: [remoteBooked()],
      catalog: [],
    });
    expect(frequent[0]?.serviceName).toBe(SERVICE_NAME);
    expect(frequent[0]?.serviceName).not.toMatch(/^svc-/);
  });

  it("does not treat a BOOKED appointment with completed Treatment as 下次預約", () => {
    const duringSlot = new Date("2026-10-06T12:49:00+08:00");
    expect(
      deriveNextAppointment({
        customer: customer(),
        appointments: [remoteBooked()],
        now: duringSlot,
      }),
    ).not.toBeNull();
    expect(
      deriveNextAppointment({
        customer: customer(),
        appointments: [remoteBooked()],
        now: duringSlot,
        completedTreatmentAppointmentIds: [APT],
      }),
    ).toBeNull();
  });

  it("keeps 最近到店 and 完成服務 from the completed Treatment", () => {
    const treatments = [completedTreatment()];
    const appointments = [remoteBooked()];
    expect(
      deriveLastVisitLabel({
        customer: customer(),
        appointments,
        treatments,
      }),
    ).toBe("2026/10/06");
    const timeline = deriveCustomerTimeline({
      customerId: CUST,
      treatments,
      appointments,
      followUps: [],
      consultations: [],
      transactions: [],
      catalog,
    });
    expect(timeline[0]?.typeLabel).toBe("完成服務");
    expect(timeline[0]?.title).toBe(SERVICE_NAME);
  });

  it("presents Calendar / Today from Treatment without mutating Appointment status", () => {
    expect(presentAppointmentStatusFromTreatment("BOOKED", "completed")).toBe(
      "COMPLETED",
    );
    expect(presentAppointmentStatusFromTreatment("BOOKED", "draft")).toBe(
      "IN_SERVICE",
    );
    expect(presentAppointmentStatusFromTreatment("BOOKED")).toBe("BOOKED");
    expect(presentAppointmentStatusFromTreatment("CANCELLED", "completed")).toBe(
      "CANCELLED",
    );
    const today = read("features/today/TodayDashboard.tsx");
    const calendar = read("features/calendar/CalendarPage.tsx");
    const quick = read("features/calendar/AppointmentQuickView.tsx");
    expect(today).toMatch(/presentAppointmentStatusFromTreatment/);
    expect(calendar).toMatch(/presentAppointmentStatusFromTreatment/);
    expect(quick).toMatch(/presentAppointmentStatusFromTreatment/);
    expect(today).not.toMatch(/runAuthenticatedAppointmentWriteMutate/);
    expect(calendar).not.toMatch(/runAuthenticatedAppointmentWriteMutate/);
  });

  it("wires Customer 360 onto the existing remote Service catalog, not a second map", () => {
    const page = read("app/staff/(app)/customers/[id]/page.tsx");
    const profile = read("features/customers/CustomerProfilePage.tsx");
    const snapshot = read("features/customers/use-customer-360.ts");
    const derived = read("lib/customers/customer-360.ts");
    expect(page).toMatch(/isServiceRemoteReadPilotEnabled/);
    expect(page).toMatch(/service-remote-read-flag/);
    expect(page).not.toMatch(/service-remote-read-pilot/);
    expect(profile).toMatch(/useServiceRemoteList/);
    expect(profile).toMatch(/remoteCatalog:/);
    expect(snapshot).toMatch(/remoteCatalog != null/);
    expect(snapshot).toMatch(/completedTreatmentAppointmentIds/);
    expect(derived).toMatch(/resolveCanonicalServiceDisplayName/);
    expect(derived).not.toMatch(/美波澎潤upupSPA/);
    expect(profile).not.toMatch(/美波澎潤upupSPA/);
  });
});
