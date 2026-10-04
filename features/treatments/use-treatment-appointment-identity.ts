"use client";

import { useEffect, useState } from "react";
import {
  findAppointmentForCustomer,
  getAppointmentById,
} from "@/lib/appointment-store";
import {
  getRemotePilotAppointment,
  listRemotePilotAppointmentsByCustomer,
} from "@/lib/appointments/appointment-remote-read-pilot";
import { useAppointmentRemoteWriteRevision } from "@/lib/appointments/use-appointment-remote-write-revision";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import {
  pickRemoteAppointmentForCustomer,
  resolveTreatmentAppointmentIdentitySource,
  toTreatmentAppointment,
  type TreatmentIdentitySource,
} from "@/lib/treatments/treatment-identity";
import type { Appointment } from "@/types";

export type TreatmentAppointmentIdentity =
  | { status: "loading"; source: TreatmentIdentitySource }
  | { status: "error"; source: "remote"; message: string }
  | { status: "empty"; source: TreatmentIdentitySource }
  | { status: "ready"; source: TreatmentIdentitySource; appointment: Appointment };

type Settled = Exclude<TreatmentAppointmentIdentity, { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote appointment read failed";
}

export function useTreatmentAppointmentIdentity(input: {
  organizationId: string;
  customerId: string;
  appointmentId?: string | null;
  appointmentRemoteReadPilot: boolean;
}): TreatmentAppointmentIdentity {
  const source = resolveTreatmentAppointmentIdentitySource(
    input.appointmentRemoteReadPilot,
  );
  const writeRevision = useAppointmentRemoteWriteRevision();
  const appointmentId = input.appointmentId?.trim() ?? "";
  const requestKey = [
    source,
    input.organizationId,
    input.customerId,
    appointmentId,
    writeRevision,
  ].join(":");
  const [remote, setRemote] = useState<{ key: string; state: Settled } | null>(null);

  useEffect(() => {
    if (source !== "remote" || !input.customerId) return undefined;
    let cancelled = false;

    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const row = appointmentId
          ? await getRemotePilotAppointment(input.organizationId, appointmentId, client)
          : pickRemoteAppointmentForCustomer(
              await listRemotePilotAppointmentsByCustomer(
                input.organizationId,
                input.customerId,
                client,
              ),
            );
        if (cancelled) return;
        setRemote({
          key: requestKey,
          state: row
            ? {
                status: "ready",
                source: "remote",
                appointment: toTreatmentAppointment(row),
              }
            : { status: "empty", source: "remote" },
        });
      } catch (error: unknown) {
        if (cancelled) return;
        setRemote({
          key: requestKey,
          state: { status: "error", source: "remote", message: errorMessage(error) },
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [appointmentId, input.customerId, input.organizationId, requestKey, source]);

  if (source === "remote") {
    if (!input.customerId) return { status: "empty", source: "remote" };
    if (!remote || remote.key !== requestKey) {
      return { status: "loading", source: "remote" };
    }
    return remote.state;
  }

  const local = appointmentId
    ? getAppointmentById(appointmentId, input.organizationId)
    : findAppointmentForCustomer(input.customerId, input.organizationId);
  return local
    ? { status: "ready", source: "local", appointment: local }
    : { status: "empty", source: "local" };
}
