"use client";

import { useEffect, useState } from "react";
import { listRemoteTodayAppointmentsByLocation } from "@/lib/appointments/today-remote-read-pilot";
import { useAppointmentRemoteWriteRevision } from "@/lib/appointments/use-appointment-remote-write-revision";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";

export type TodayRemoteReadState =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: ScheduleAppointment[] }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled = Exclude<TodayRemoteReadState, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote appointment read failed";
}

export function useTodayRemoteAppointments(input: {
  organizationId: string;
  locationAppId: string;
  nowIso: string | null;
  enabled: boolean;
}): TodayRemoteReadState {
  const writeRevision = useAppointmentRemoteWriteRevision();
  const requestKey = [
    "today",
    input.organizationId,
    input.locationAppId,
    input.nowIso ?? "",
    String(writeRevision),
  ].join(":");
  const [result, setResult] = useState<{
    key: string;
    state: Settled;
  } | null>(null);

  useEffect(() => {
    if (!input.enabled || !input.nowIso || !input.locationAppId) return undefined;
    const nowIso = input.nowIso;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const rows = await listRemoteTodayAppointmentsByLocation(
          input.organizationId,
          input.locationAppId,
          nowIso,
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
    input.nowIso,
    requestKey,
  ]);

  if (!input.enabled) return { status: "off" };
  if (!input.nowIso || !input.locationAppId) return { status: "loading" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}
