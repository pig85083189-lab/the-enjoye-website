"use client";

import { useEffect, useState } from "react";
import {
  APPOINTMENT_REMOTE_WRITE_PILOT_ENV,
  AppointmentWritePilotDeniedError,
  runAuthenticatedAppointmentWriteCreate,
  type AppointmentWriteClient,
} from "@/lib/appointments/appointment-remote-write-pilot";
import { CALENDAR_REMOTE_READ_PILOT_ENV } from "@/lib/appointments/calendar-remote-read-flag";
import {
  loadAppointmentWriteFormCatalog,
  type AppointmentWriteFormCatalog,
} from "@/lib/appointments/appointment-write-form-catalog";
import { appointmentWriteUserMessage } from "@/lib/appointments/appointment-write-ui-error";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

export type CalendarRemoteWriteState =
  | { status: "off"; canCreate: false; canCancel: false }
  | { status: "loading"; canCreate: false; canCancel: false }
  | { status: "denied"; canCreate: false; canCancel: false; message: string }
  | { status: "error"; canCreate: false; canCancel: false; message: string }
  | {
      status: "ready";
      canCreate: true;
      canCancel: boolean;
      catalog: AppointmentWriteFormCatalog;
    };

function writeClient(): AppointmentWriteClient | null {
  return createBrowserClientOrNull() as AppointmentWriteClient | null;
}

export function useCalendarRemoteWrite(enabled: boolean): CalendarRemoteWriteState {
  const [result, setResult] = useState<Exclude<
    CalendarRemoteWriteState,
    { status: "off" } | { status: "loading" }
  > | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = writeClient();
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const catalog = await loadAppointmentWriteFormCatalog(client);
        if (cancelled) return;
        if (!catalog.canCreate) {
          setResult({
            status: "denied",
            canCreate: false,
            canCancel: false,
            message: appointmentWriteUserMessage(new AppointmentWritePilotDeniedError()),
          });
          return;
        }
        setResult({
          status: "ready",
          canCreate: true,
          canCancel: catalog.canCancel,
          catalog,
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          status: "error",
          canCreate: false,
          canCancel: false,
          message: appointmentWriteUserMessage(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  if (!enabled) return { status: "off", canCreate: false, canCancel: false };
  if (!result) return { status: "loading", canCreate: false, canCancel: false };
  return result;
}

export async function submitCalendarRemoteAppointmentCreate(input: {
  organizationId: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  appointmentId: string;
  dateYmd: string;
  startHm: string;
  durationMinutes: number;
  customerNote?: string;
  internalNote?: string;
}) {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  return runAuthenticatedAppointmentWriteCreate(client, input, {
    ...process.env,
    [APPOINTMENT_REMOTE_WRITE_PILOT_ENV]: "1",
    [CALENDAR_REMOTE_READ_PILOT_ENV]: "1",
  });
}
