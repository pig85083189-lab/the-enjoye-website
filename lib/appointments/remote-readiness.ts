/**
 * Phase 1C-5A readiness constants for a future first remote Appointment.
 * This module does not insert, upsert, or call Supabase.
 */

import { durationBetween, type ScheduleAppointment } from "@/lib/appointments/domain";
import type { CreateAppointmentInput } from "@/lib/appointments/store";
import { addMinutesToIso, taipeiLocalToUtcIso } from "@/lib/persistence/appointment-time";
import { LOC_ENJOYE_PRIMARY_ID, ORG_ENJOYE_ID } from "@/lib/tenant/constants";

export const FUTURE_QA_APPOINTMENT = {
  organizationAppId: ORG_ENJOYE_ID,
  organizationDbId: "62bd49b6-a4c3-4da1-b53e-4746923685f1",
  locationAppId: LOC_ENJOYE_PRIMARY_ID,
  locationDbId: "c46b700c-bb42-45ce-be53-4484e217c3f8",
  customerAppId: "cust-muqh2jn6-xpjssl",
  customerDbId: "f4be267b-8159-4b7b-920c-44ac996b3d8e",
  customerName: "Remote QA Customer",
  serviceAppId: "svc-muqm5pht-nqlpr3",
  serviceDbId: "bd4c1822-5375-48b6-a4f4-dd231da10ef2",
  serviceName: "Remote QA Bust Care",
  staffAppId: "staff-001",
  staffName: "怡蓁",
  localDateYmd: "2026-10-09",
  localStartHm: "10:00",
  durationMinutes: 100,
  status: "BOOKED",
  timezone: "Asia/Taipei",
} as const;

export function futureQaAppointmentUtcRange(): { startAt: string; endAt: string } {
  const startAt = taipeiLocalToUtcIso(
    FUTURE_QA_APPOINTMENT.localDateYmd,
    FUTURE_QA_APPOINTMENT.localStartHm,
  );
  return {
    startAt,
    endAt: addMinutesToIso(startAt, FUTURE_QA_APPOINTMENT.durationMinutes),
  };
}

export function buildFutureFirstAppointmentDomainInput(): CreateAppointmentInput & {
  customerName: string;
  serviceName: string;
  staffName: string;
  status: ScheduleAppointment["status"];
} {
  const { startAt, endAt } = futureQaAppointmentUtcRange();
  return {
    locationId: FUTURE_QA_APPOINTMENT.locationAppId,
    customerId: FUTURE_QA_APPOINTMENT.customerAppId,
    serviceId: FUTURE_QA_APPOINTMENT.serviceAppId,
    staffId: FUTURE_QA_APPOINTMENT.staffAppId,
    startAt,
    endAt,
    createdBy: FUTURE_QA_APPOINTMENT.staffAppId,
    customerName: FUTURE_QA_APPOINTMENT.customerName,
    serviceName: FUTURE_QA_APPOINTMENT.serviceName,
    staffName: FUTURE_QA_APPOINTMENT.staffName,
    status: FUTURE_QA_APPOINTMENT.status,
  };
}

export function futureQaAppointmentDerivedDuration(): number {
  const { startAt, endAt } = futureQaAppointmentUtcRange();
  return durationBetween(startAt, endAt);
}
