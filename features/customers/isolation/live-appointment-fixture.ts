import { FUTURE_QA_APPOINTMENT, futureQaAppointmentUtcRange } from "@/lib/appointments/remote-readiness";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { Customer } from "@/types";

const { startAt, endAt } = futureQaAppointmentUtcRange();

export const ISOLATION_CUSTOMER_APP_ID = FUTURE_QA_APPOINTMENT.customerAppId;

export function liveMappedAppointment(
  overrides: Partial<ScheduleAppointment> = {},
): ScheduleAppointment {
  return {
    id: "apt-muqrindw-yt0l5z",
    organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
    locationId: FUTURE_QA_APPOINTMENT.locationAppId,
    customerId: FUTURE_QA_APPOINTMENT.customerAppId,
    customerName: FUTURE_QA_APPOINTMENT.customerName,
    serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
    serviceName: FUTURE_QA_APPOINTMENT.serviceName,
    staffId: FUTURE_QA_APPOINTMENT.staffAppId,
    staffName: FUTURE_QA_APPOINTMENT.staffName,
    startAt,
    endAt,
    durationMinutes: 100,
    status: "BOOKED",
    notes: [],
    createdAt: "2026-10-02T09:30:20.517Z",
    updatedAt: "2026-10-02T09:30:20.517Z",
    ...overrides,
  };
}

export function liveRemoteCustomerShape(
  overrides: Partial<Customer> = {},
): Customer {
  return {
    id: FUTURE_QA_APPOINTMENT.customerAppId,
    organizationId: FUTURE_QA_APPOINTMENT.organizationAppId,
    name: FUTURE_QA_APPOINTMENT.customerName,
    phone: "",
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
    joinedAt: "2026/10/02",
    createdAt: "2026-10-02T04:30:00.000Z",
    updatedAt: "2026-10-02T04:30:00.000Z",
    ...overrides,
  };
}
