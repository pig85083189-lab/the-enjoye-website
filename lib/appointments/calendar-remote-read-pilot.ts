/**
 * Phase 1C-5D Calendar remote appointment read pilot.
 *
 * Client / test import only. Server Components must use
 * calendar-remote-read-flag.ts so the adapter graph stays out of the
 * RSC calendar page module.
 *
 * Scoped to /staff/calendar appointment cards. Does not enable
 * BEAUTY_OS_PERSISTENCE or BEAUTY_OS_PERSISTENCE_ALLOW_REMOTE.
 * Explicit activation: BEAUTY_OS_CALENDAR_REMOTE_READ_PILOT=1
 * Production default is off until that env is set.
 *
 * Customer 360 and Today stay on their own independent pilot flags.
 */

import type { ScheduleAppointment } from "@/lib/appointments/domain";
import {
  createAuthenticatedAppointmentReadPersistence,
} from "@/lib/appointments/appointment-remote-read-pilot";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { IdentityCatalogError } from "@/lib/persistence/identity-errors";

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
  const organizationAppId = organizationId.trim();
  const selectedLocationAppId = locationAppId.trim();
  if (!organizationAppId || !selectedLocationAppId) {
    throw new IdentityCatalogError("missing_scope", "必須先選擇店家與分店");
  }
  const persistence = await createAuthenticatedAppointmentReadPersistence(client, {
    organizationAppId,
    locationAppId: selectedLocationAppId,
  });
  if (persistence.identity.organizationAppId !== organizationAppId) {
    throw new IdentityCatalogError("missing_membership", "此帳號沒有這個店家的員工身分");
  }
  return persistence.appointments.listByLocationAndRange({
    organizationId: organizationAppId,
    locationAppId: selectedLocationAppId,
    startsAt,
    endsAt,
  });
}
