/**
 * Phase 1C-5E Today remote appointment read pilot.
 *
 * Client / test import only. Server Components must use
 * today-remote-read-flag.ts so the adapter graph stays out of the
 * RSC Today page module.
 *
 * Scoped to /staff/today appointment cards. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Explicit activation: BEAUTY_OS_TODAY_REMOTE_READ_PILOT=1
 * Production default is off until that env is set.
 *
 * Calendar and Customer 360 stay on their own pilot flags.
 */

import { createAuthenticatedAppointmentReadPersistence } from "@/lib/appointments/appointment-remote-read-pilot";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { todayRemoteQueryRangeFromInstant } from "@/lib/calendar/calendar-appointment-time";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";

export {
  TODAY_REMOTE_READ_PILOT_ENV,
  isTodayRemoteReadPilotEnabled,
} from "./today-remote-read-flag";

export {
  AppointmentRemoteReadOnlyError,
  APPOINTMENT_REMOTE_READ_ONLY_MESSAGE,
} from "@/lib/persistence/authenticated-appointment-read-store";

export async function listRemoteTodayAppointmentsByLocation(
  organizationId: string,
  locationAppId: string,
  now: Date | string,
  client: IdentitySupabaseClient,
): Promise<ScheduleAppointment[]> {
  const range = todayRemoteQueryRangeFromInstant(now);
  const persistence = await createAuthenticatedAppointmentReadPersistence(
    client,
    organizationId,
  );
  return persistence.appointments.listByLocationAndRange({
    organizationId,
    locationAppId,
    startsAt: range.startsAt,
    endsAt: range.endsAt,
  });
}
