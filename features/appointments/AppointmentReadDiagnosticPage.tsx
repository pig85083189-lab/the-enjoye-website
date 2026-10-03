"use client";

import { Component, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import {
  DIAGNOSTIC_CUSTOMER_APP_ID,
  runAppointmentReadDiagnosticStages,
  sanitizeDiagnosticError,
  sanitizeDiagnosticText,
  type DiagnosticStageResult,
  type SanitizedError,
} from "@/lib/appointments/appointment-read-diagnostic";
import { APPOINTMENT_READ_DIAGNOSTIC_ROUTE } from "@/lib/appointments/appointment-read-diagnostic-flag";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { formatTaipeiAppointmentDisplay } from "@/lib/persistence/appointment-time";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { ScheduleAppointment } from "@/lib/appointments/domain";

type CapturedClientError = SanitizedError & { source: "onerror" | "unhandledrejection" };

class DiagnosticErrorBoundary extends Component<
  { children: ReactNode; label: string },
  { error: SanitizedError | null }
> {
  state: { error: SanitizedError | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: SanitizedError } {
    return { error: sanitizeDiagnosticError(error) };
  }

  render() {
    if (this.state.error) {
      return (
        <Card padding="md">
          <p className="font-medium text-text">{this.props.label} FAIL</p>
          <p className="mt-2 text-sm text-secondary-text">{this.state.error.name}</p>
          <p className="mt-1 text-sm text-secondary-text">{this.state.error.message}</p>
          {this.state.error.stackLocation ? (
            <p className="mt-1 text-xs text-secondary-text">{this.state.error.stackLocation}</p>
          ) : null}
        </Card>
      );
    }
    return this.props.children;
  }
}

function StageIRender({ item }: { item: ScheduleAppointment }) {
  const display = formatTaipeiAppointmentDisplay(item.startAt, item.endAt);
  return (
    <div className="rounded-2xl border border-border bg-surface px-4 py-3">
      <p className="text-sm text-secondary-text">{display.date}</p>
      <p className="text-sm text-secondary-text">{display.time}</p>
      <p className="mt-1 font-medium text-text">{item.serviceName}</p>
      <p className="mt-1 text-sm text-text">美容師：{item.staffName}</p>
      <p className="mt-1 text-sm text-secondary-text">
        {item.status} · {item.id}
      </p>
    </div>
  );
}

function StageCard({ stage }: { stage: DiagnosticStageResult }) {
  return (
    <Card padding="md" data-diagnostic-stage={stage.id} data-diagnostic-status={stage.status}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-secondary-text">Stage {stage.id}</p>
          <p className="mt-1 font-medium text-text">{stage.label}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
          {stage.status}
        </span>
      </div>
      {stage.detail ? (
        <pre className="mt-3 overflow-x-auto text-xs text-secondary-text">
          {sanitizeDiagnosticText(JSON.stringify(stage.detail, null, 2))}
        </pre>
      ) : null}
      {stage.error ? (
        <div className="mt-3 space-y-1 text-sm text-secondary-text">
          <p>{stage.error.name}</p>
          <p>{stage.error.message}</p>
          {stage.error.stackLocation ? <p>{stage.error.stackLocation}</p> : null}
        </div>
      ) : null}
    </Card>
  );
}

export function AppointmentReadDiagnosticPage() {
  const [stages, setStages] = useState<DiagnosticStageResult[] | null>(null);
  const [clientErrors, setClientErrors] = useState<CapturedClientError[]>([]);
  const [bootError, setBootError] = useState<SanitizedError | null>(null);

  useLayoutEffect(() => {
    function capture(source: CapturedClientError["source"], error: unknown) {
      const sanitized = sanitizeDiagnosticError(error);
      setClientErrors((current) => [...current, { ...sanitized, source }]);
    }
    const onError = (event: ErrorEvent) => {
      capture("onerror", event.error ?? event.message);
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      capture("unhandledrejection", event.reason);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!client) {
          throw new Error("Authenticated Supabase client is unavailable");
        }
        const next = await runAppointmentReadDiagnosticStages(client, DIAGNOSTIC_CUSTOMER_APP_ID);
        if (!cancelled) setStages(next);
      } catch (error: unknown) {
        if (!cancelled) setBootError(sanitizeDiagnosticError(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const mapped = (stages?.find((stage) => stage.id === "G")?.detail?.appointments ?? []) as Array<
    ScheduleAppointment & Record<string, unknown>
  >;
  const stageIItems = mapped.filter((row) => typeof row.id === "string" && typeof row.startAt === "string");

  return (
    <DiagnosticErrorBoundary label="Diagnostic page">
      <div className="mx-auto w-full max-w-3xl space-y-4 pb-16">
        <header className="space-y-2">
          <p className="text-xs text-secondary-text">TEMPORARY Preview diagnostic</p>
          <h1 className="text-xl font-semibold text-text">Appointment remote read diagnostic</h1>
          <p className="text-sm text-secondary-text">
            Route {APPOINTMENT_READ_DIAGNOSTIC_ROUTE}. Publishable session client only. No writes.
            Production unavailable. Delete after Owner QA.
          </p>
          <p className="text-sm text-secondary-text">
            Scope: CustomerProfilePage statically imports AppointmentsTab, so a module-init crash
            would also break overview. AppointmentsTab only mounts at ?tab=appointments. This page
            does not import CustomerProfilePage or AppointmentsTab.
          </p>
        </header>

        {clientErrors.length > 0 ? (
          <Card padding="md" data-diagnostic-client-errors>
            <p className="font-medium text-text">Captured browser errors</p>
            <div className="mt-3 space-y-3">
              {clientErrors.map((error, index) => (
                <div key={`${error.source}-${index}`} className="text-sm text-secondary-text">
                  <p>{error.source}</p>
                  <p>{error.name}</p>
                  <p>{error.message}</p>
                  {error.stackLocation ? <p>{error.stackLocation}</p> : null}
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {bootError ? (
          <Card padding="md">
            <p className="font-medium text-text">Diagnostic boot FAIL</p>
            <p className="mt-2 text-sm text-secondary-text">{bootError.name}</p>
            <p className="mt-1 text-sm text-secondary-text">{bootError.message}</p>
            {bootError.stackLocation ? (
              <p className="mt-1 text-xs text-secondary-text">{bootError.stackLocation}</p>
            ) : null}
          </Card>
        ) : null}

        {!stages && !bootError ? (
          <p className="text-sm text-secondary-text">Running stages A–H…</p>
        ) : null}

        {stages?.map((stage) => (
          <StageCard key={stage.id} stage={stage} />
        ))}

        <DiagnosticErrorBoundary label="Stage I">
          <Card padding="md" data-diagnostic-stage="I">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs text-secondary-text">Stage I</p>
                <p className="mt-1 font-medium text-text">minimal React render of the appointment</p>
              </div>
              <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
                {stageIItems.length > 0 ? "PASS" : stages ? "SKIP" : "WAIT"}
              </span>
            </div>
            <div className="mt-3 space-y-3">
              {stageIItems.map((item) => (
                <StageIRender
                  key={item.id}
                  item={{
                    id: item.id,
                    organizationId: String(item.organizationId ?? ""),
                    locationId: String(item.locationId ?? ""),
                    customerId: String(item.customerId ?? ""),
                    customerName: String(item.customerName ?? ""),
                    serviceId: String(item.serviceId ?? ""),
                    serviceName: String(item.serviceName ?? ""),
                    staffId: String(item.staffId ?? ""),
                    staffName: String(item.staffName ?? ""),
                    startAt: String(item.startAt ?? ""),
                    endAt: String(item.endAt ?? ""),
                    durationMinutes: Number(item.durationMinutes ?? 0),
                    status: (item.status as ScheduleAppointment["status"]) ?? "BOOKED",
                    notes: Array.isArray(item.notes) ? item.notes : [],
                    createdAt: String(item.createdAt ?? ""),
                    updatedAt: String(item.updatedAt ?? ""),
                  }}
                />
              ))}
              {stages && stageIItems.length === 0 ? (
                <p className="text-sm text-secondary-text">No mapped appointment to render.</p>
              ) : null}
            </div>
          </Card>
        </DiagnosticErrorBoundary>
      </div>
    </DiagnosticErrorBoundary>
  );
}
