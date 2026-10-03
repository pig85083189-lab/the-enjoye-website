"use client";

import { useEffect, useState } from "react";
import { listRemotePilotAppointmentsByCustomer } from "@/lib/appointments/appointment-remote-read-pilot";
import { useAppointmentRemoteWriteRevision } from "@/lib/appointments/use-appointment-remote-write-revision";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

export type AppointmentRemoteReadState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: ScheduleAppointment[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled = Exclude<AppointmentRemoteReadState, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote appointment read failed";
}

export function useCustomerRemoteAppointments(
  organizationId: string,
  customerId: string,
  enabled: boolean,
): AppointmentRemoteReadState {
  const writeRevision = useAppointmentRemoteWriteRevision();
  const requestKey = `appointments:${organizationId}:${customerId}:${writeRevision}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const rows = await listRemotePilotAppointmentsByCustomer(
          organizationId,
          customerId,
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
  }, [enabled, organizationId, customerId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}
