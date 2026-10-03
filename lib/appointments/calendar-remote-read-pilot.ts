/**
 * Phase 1C-5D Calendar remote appointment read pilot.
 *
 * Client / test import only. Server Components must use
 * calendar-remote-read-flag.ts so the adapter graph stays out of the
 * RSC calendar page module.
 *
 * Scoped to /staff/calendar appointment cards. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Preview activation: BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT=1
 * Production is always off, even if that env is present.
 *
 * Customer 360 and Today stay on their own sources.
 */

import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  createAuthenticatedAppointmentReadPersistence,
} from "@/lib/appointments/appointment-remote-read-pilot";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";

export {
  CALENDAR_REMOTE_READ_PILOT_ENV,
  isCalendarRemoteReadPilotEnabled,
} from "./calendar-remote-read-flag";

export {
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-appointment-read-store";

export async function listRemoteCalendarAppointmentsByLocationAndRange(
  organizationId: string,
  locationAppId: string,
  startsAt: string,
  endsAt: string,
  client: IdentitySupabaseClient,
): Promise<ScheduleAppointment[]> {
  const persistence = await createAuthenticatedAppointmentReadPersistence(client);
  return persistence.appointments.listByLocationAndRange({
    organizationId,
    locationAppId,
    startsAt,
    endsAt,
  });
}
