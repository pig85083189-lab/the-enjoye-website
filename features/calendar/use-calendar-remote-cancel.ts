"use client";

import { APPOINTMENT_REMOTE_MUTATE_PILOT_ENV } from "@/lib/appointments/appointment-remote-mutate-flag";
import { runAuthenticatedAppointmentWriteMutate } from "@/lib/appointments/appointment-remote-mutate-pilot";
import { APPOINTMENT_REMOTE_WRITE_PILOT_ENV } from "@/lib/appointments/appointment-remote-write-flag";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "@/lib/appointments/calendar-remote-read-flag";
import { AppointmentWriteStaleError } from "@/lib/appointments/appointment-write-mutate-errors";
import { emitAppointmentRemoteWriteRefresh } from "@/lib/appointments/appointment-write-refresh";
import type { AppointmentMutateClient } from "@/lib/appointments/appointment-remote-mutate-pilot";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

function mutateClient(): AppointmentMutateClient | null {
  return createBrowserClientOrNull() as AppointmentMutateClient | null;
}

export async function submitCalendarRemoteAppointmentCancel(input: {
  organizationId: string;
  appointmentId: string;
  expectedUpdatedAt: string;
  customerId?: string;
  locationId?: string;
  startAt?: string;
  statusReason?: string;
}) {
  const client = mutateClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  try {
    return await runAuthenticatedAppointmentWriteMutate(
      client,
      {
        kind: "cancel",
        appointmentId: input.appointmentId,
        expectedUpdatedAt: input.expectedUpdatedAt,
        organizationId: input.organizationId,
        status: "CANCELLED",
        statusReason: input.statusReason,
      },
      {
        ...process.env,
        [APPOINTMENT_REMOTE_MUTATE_PILOT_ENV]: "1",
        [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
        [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
      },
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
