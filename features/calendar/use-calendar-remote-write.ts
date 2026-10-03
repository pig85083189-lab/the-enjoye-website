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
  | { status: "off"; canCreate: false }
  | { status: "loading"; canCreate: false }
  | { status: "denied"; canCreate: false; message: string }
  | { status: "error"; canCreate: false; message: string }
  | {
      status: "ready";
      canCreate: true;
      catalog: AppointmentWriteFormCatalog;
    };

function writeClient(): AppointmentWriteClient | null {
  return createBrowserClientOrNull() as AppointmentWriteClient | null;
}

export function useCalendarRemoteWrite(enabled: boolean): CalendarRemoteWriteState {
  const [state, setState] = useState<CalendarRemoteWriteState>(
    enabled ? { status: "loading", canCreate: false } : { status: "off", canCreate: false },
  );

  useEffect(() => {
    if (!enabled) {
      setState({ status: "off", canCreate: false });
      return undefined;
    }
    let cancelled = false;
    setState({ status: "loading", canCreate: false });
    void (async () => {
      try {
        const client = writeClient();
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const catalog = await loadAppointmentWriteFormCatalog(client);
        if (cancelled) return;
        if (!catalog.canCreate) {
          setState({
            status: "denied",
            canCreate: false,
            message: appointmentWriteUserMessage(new AppointmentWritePilotDeniedError()),
          });
          return;
        }
        setState({ status: "ready", canCreate: true, catalog });
      } catch (error: unknown) {
        if (cancelled) return;
        setState({
          status: "error",
          canCreate: false,
          message: appointmentWriteUserMessage(error),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return state;
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
