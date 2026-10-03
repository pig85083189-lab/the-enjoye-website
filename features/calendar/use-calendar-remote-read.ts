"use client";

import { useEffect, useState } from "react";
import { listRemoteCalendarAppointmentsByLocationAndRange } from "@/lib/appointments/calendar-remote-read-pilot";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

export type CalendarRemoteReadState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: ScheduleAppointment[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled = Exclude<CalendarRemoteReadState, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote appointment read failed";
}

export function useCalendarRemoteAppointments(input: {
  organizationId: string;
  locationAppId: string;
  startsAt: string;
  endsAt: string;
  enabled: boolean;
}): CalendarRemoteReadState {
  const requestKey = [
    "calendar",
    input.organizationId,
    input.locationAppId,
    input.startsAt,
    input.endsAt,
  ].join(":");
  const [result, setResult] = useState<{
    key: string;
    state: Settled;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const rows = await listRemoteCalendarAppointmentsByLocationAndRange(
          input.organizationId,
          input.locationAppId,
          input.startsAt,
          input.endsAt,
          client,
        );
        if (cancelled) return;
        setResult({
          key: requestKey,
          state:
            rows.length === 0
              ? { status: "empty" }
              : { status: "data", value: rows },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: { status: "error", message: errorMessage(error) },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    input.enabled,
    input.organizationId,
    input.locationAppId,
    input.startsAt,
    input.endsAt,
    requestKey,
  ]);

  if (!input.enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}
