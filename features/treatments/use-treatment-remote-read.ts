"use client";

import { useEffect, useState } from "react";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import {
  getRemotePilotTreatment,
  getRemotePilotTreatmentByAppointment,
  listRemotePilotAppointmentsForTreatments,
  listRemotePilotTreatments,
  listRemotePilotTreatmentsByCustomer,
} from "@/lib/treatments/treatment-remote-read-pilot";
import { useTreatmentRemoteWriteRevision } from "@/lib/treatments/use-treatment-remote-write-revision";
import type { TreatmentDraft } from "@/types/treatment";

export type TreatmentRemoteReadState<T> =
  | { status: "off" }
  | { status: "loading" }
  | { status: "data"; value: T }
  | { status: "empty" }
  | { status: "error"; message: string };

type Settled<T> = Exclude<TreatmentRemoteReadState<T>, { status: "off" } | { status: "loading" }>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Remote treatment read failed";
}

function readClient(): IdentitySupabaseClient | null {
  return createBrowserClientOrNull() as IdentitySupabaseClient | null;
}

export function treatmentsFromRemoteListState(
  state: TreatmentRemoteReadState<TreatmentDraft[]>,
): TreatmentDraft[] {
  return state.status === "data" ? state.value : [];
}

export function appointmentsFromRemoteListState(
  state: TreatmentRemoteReadState<ScheduleAppointment[]>,
): ScheduleAppointment[] {
  return state.status === "data" ? state.value : [];
}

export function useTreatmentRemoteList(
  organizationId: string,
  enabled: boolean,
): TreatmentRemoteReadState<TreatmentDraft[]> {
  const writeRevision = useTreatmentRemoteWriteRevision();
  const requestKey = `treatments:${organizationId}:${writeRevision}`;
  const [result, setResult] = useState<{ key: string; state: Settled<TreatmentDraft[]> } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const rows = await listRemotePilotTreatments(organizationId, client);
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: rows.length === 0 ? { status: "empty" } : { status: "data", value: rows },
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
  }, [enabled, organizationId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function useTreatmentRemoteListByCustomer(
  organizationId: string,
  customerId: string,
  enabled: boolean,
): TreatmentRemoteReadState<TreatmentDraft[]> {
  const writeRevision = useTreatmentRemoteWriteRevision();
  const requestKey = `treatments-customer:${organizationId}:${customerId}:${writeRevision}`;
  const [result, setResult] = useState<{ key: string; state: Settled<TreatmentDraft[]> } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled || !customerId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const rows = await listRemotePilotTreatmentsByCustomer(
          organizationId,
          customerId,
          client,
        );
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: rows.length === 0 ? { status: "empty" } : { status: "data", value: rows },
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
  if (!customerId) return { status: "empty" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function useTreatmentRemoteDetail(
  organizationId: string,
  treatmentId: string,
  enabled: boolean,
): TreatmentRemoteReadState<TreatmentDraft> {
  const writeRevision = useTreatmentRemoteWriteRevision();
  const requestKey = `treatment:${organizationId}:${treatmentId}:${writeRevision}`;
  const [result, setResult] = useState<{ key: string; state: Settled<TreatmentDraft> } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled || !treatmentId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const row = await getRemotePilotTreatment(organizationId, treatmentId, client);
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: row ? { status: "data", value: row } : { status: "empty" },
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
  }, [enabled, organizationId, treatmentId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!treatmentId) return { status: "empty" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function useTreatmentRemoteByAppointment(
  organizationId: string,
  appointmentId: string,
  enabled: boolean,
): TreatmentRemoteReadState<TreatmentDraft> {
  const writeRevision = useTreatmentRemoteWriteRevision();
  const requestKey = `treatment-appointment:${organizationId}:${appointmentId}:${writeRevision}`;
  const [result, setResult] = useState<{ key: string; state: Settled<TreatmentDraft> } | null>(
    null,
  );

  useEffect(() => {
    if (!enabled || !appointmentId) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const row = await getRemotePilotTreatmentByAppointment(
          organizationId,
          appointmentId,
          client,
        );
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: row ? { status: "data", value: row } : { status: "empty" },
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
  }, [enabled, organizationId, appointmentId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!appointmentId) return { status: "empty" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}

export function useTreatmentRemoteAppointments(
  organizationId: string,
  enabled: boolean,
): TreatmentRemoteReadState<ScheduleAppointment[]> {
  const writeRevision = useTreatmentRemoteWriteRevision();
  const requestKey = `treatment-appointments:${organizationId}:${writeRevision}`;
  const [result, setResult] = useState<{
    key: string;
    state: Settled<ScheduleAppointment[]>;
  } | null>(null);

  useEffect(() => {
    if (!enabled) return undefined;
    let cancelled = false;
    void (async () => {
      try {
        const client = readClient();
        if (!client) throw new Error("Authenticated Supabase client is unavailable");
        const rows = await listRemotePilotAppointmentsForTreatments(organizationId, client);
        if (cancelled) return;
        setResult({
          key: requestKey,
          state: rows.length === 0 ? { status: "empty" } : { status: "data", value: rows },
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
  }, [enabled, organizationId, requestKey]);

  if (!enabled) return { status: "off" };
  if (!result || result.key !== requestKey) return { status: "loading" };
  return result.state;
}
