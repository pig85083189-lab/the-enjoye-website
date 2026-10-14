"use client";

import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";
import { runAuthenticatedAppointmentWriteMutate } from "@/lib/appointments/appointment-remote-mutate-pilot";
import { APPOINTMENT_REMOTE_WRITE_PILOT_ENV } from "@/lib/appointments/appointment-remote-write-flag";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "@/lib/appointments/calendar-remote-read-flag";
import { AppointmentWriteStaleError } from "@/lib/appointments/appointment-write-mutate-errors";
import { emitAppointmentRemoteWriteRefresh } from "@/lib/appointments/appointment-write-refresh";
import type { AppointmentMutateClient } from "@/lib/appointments/appointment-remote-mutate-pilot";
import { calendarRemoteSubmitEnv } from "@/features/calendar/calendar-remote-submit-env";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function mutateClient(): AppointmentMutateClient | null {
  return createBrowserClientOrNull() as AppointmentMutateClient | null;
}

export async function submitCalendarRemoteAppointmentReschedule(input: {
  organizationId: string;
  appointmentId: string;
  expectedUpdatedAt: string;
  dateYmd: string;
  startHm: string;
  durationMinutes: number;
  customerId?: string;
  locationId?: string;
  staffId?: string;
  serviceId?: string;
  startAt?: string;
  customerNote?: string;
  internalNote?: string;
}) {
  const client = mutateClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  try {
    return await runAuthenticatedAppointmentWriteMutate(
      client,
      {
        kind: "reschedule",
        appointmentId: input.appointmentId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        organizationId: input.organizationId,
        dateYmd: input.dateYmd,
        startHm: input.startHm,
        durationMinutes: input.durationMinutes,
        customerId: input.customerId,
        locationId: input.locationId,
        staffId: input.staffId,
        serviceId: input.serviceId,
        customerNote: input.customerNote,
        internalNote: input.internalNote,
      },
      calendarRemoteSubmitEnv({
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      }),
    );
  } catch (error) {
    if (error instanceof AppointmentWriteStaleError) {
      emitAppointmentRemoteWriteRefresh({
        organizationId: input.organizationId,
        customerId: input.customerId,
        locationId: input.locationId,
        startAt: input.startAt,
      });
    }
    throw error;
  }
}
