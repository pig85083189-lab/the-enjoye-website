"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { AppointmentRemoteAdapter } from "@/lib/persistence/appointment-remote-adapter";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import { findStaffTimeOverlap } from "@/lib/appointments/appointment-queries";
import {
  APPOINTMENT_BOOTSTRAP_ROUTE,
  APPOINTMENT_STAFF_OVERLAP_MESSAGE,
  BOOTSTRAP_TARGET,
  FIRST_REMOTE_APPOINTMENT_PAYLOAD,
  canShowCreateButton,
  createFirstRemoteQaAppointment,
  findExactQaAppointment,
  loadAppointmentBootstrapContext,
  qaAppointmentTaipeiDisplay,
  type AppointmentBootstrapClient as AppointmentBootstrapSession,
  type AppointmentMappingView,
  type BootstrapIdentityView,
  type BootstrapRlsCheck,
} from "@/lib/staff-auth/appointment-bootstrap";
import type { ScheduleAppointment } from "@/lib/appointments/domain";

function passFail(value: boolean | null, expected?: boolean): string {
  if (value === true) return expected === false ? "FAIL" : "PASS";
  if (value === false) return expected === false ? "PASS" : "FAIL";
  return "NOT VERIFIED";
}

type ReadyState = {
  kind: "ready" | "existing" | "created" | "conflict";
  identity: BootstrapIdentityView;
  rls: BootstrapRlsCheck;
  mapping: AppointmentMappingView;
  appointment?: ScheduleAppointment;
};

type PageState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "rls-fail"; identity: BootstrapIdentityView; rls: BootstrapRlsCheck; mapping: AppointmentMappingView }
  | ReadyState;

export function AppointmentBootstrapClient() {
  const router = useRouter();
  const sessionRef = useRef<{
    adapter: AppointmentRemoteAdapter;
    mapper: CanonicalIdMapper;
  } | null>(null);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);
  const display = qaAppointmentTaipeiDisplay();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = createBrowserClientOrNull();
      if (!supabase) {
        if (!cancelled) setState({ kind: "unavailable" });
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace(`/staff/login?next=${encodeURIComponent(APPOINTMENT_BOOTSTRAP_ROUTE)}`);
        return;
      }
      try {
        const client = supabase as unknown as AppointmentBootstrapSession;
        const ctx = await loadAppointmentBootstrapContext(client);
        if (cancelled) return;
        sessionRef.current = { adapter: ctx.adapter, mapper: ctx.mapper };
        if (!ctx.rlsPassed || !ctx.mappingPassed || !ctx.timeSafe) {
          setState({
            kind: "rls-fail",
            identity: ctx.identity,
            rls: ctx.rls,
            mapping: ctx.mapping,
          });
          return;
        }
        const existing = await findExactQaAppointment(ctx.adapter);
        if (cancelled) return;
        if (existing) {
          const created = await createFirstRemoteQaAppointment(ctx.adapter, ctx.mapper);
          setState({
            kind: "existing",
            identity: ctx.identity,
            rls: ctx.rls,
            mapping: created.mapping,
            appointment: created.appointment,
          });
          return;
        }
        const overlap = await findStaffTimeOverlap(
          BOOTSTRAP_TARGET.organizationAppId,
          FIRST_REMOTE_APPOINTMENT_PAYLOAD,
          { appointments: ctx.adapter },
        );
        if (cancelled) return;
        if (overlap) {
          setState({
            kind: "conflict",
            identity: ctx.identity,
            rls: ctx.rls,
            mapping: ctx.mapping,
            appointment: overlap,
          });
          return;
        }
        setState({
          kind: "ready",
          identity: ctx.identity,
          rls: ctx.rls,
          mapping: ctx.mapping,
        });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Bootstrap failed";
        if (message === "unauthenticated") {
          router.replace(`/staff/login?next=${encodeURIComponent(APPOINTMENT_BOOTSTRAP_ROUTE)}`);
          return;
        }
        setState({ kind: "error", message });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  async function onCreate() {
    const session = sessionRef.current;
    if (!session || state.kind !== "ready" || busy) return;
    setBusy(true);
    setWriteError(null);
    try {
      const result = await createFirstRemoteQaAppointment(session.adapter, session.mapper);
      setState({
        kind: result.status === "existing" ? "existing" : "created",
        identity: state.identity,
        rls: state.rls,
        mapping: result.mapping,
        appointment: result.appointment,
      });
    } catch (error) {
      setWriteError(error instanceof Error ? error.message : "Create failed");
      setBusy(false);
    }
  }

  if (state.kind === "loading") {
    return (
      <main className="mx-auto max-w-xl px-6 py-10 text-[15px] text-text">
        <p>Checking Owner session…</p>
      </main>
    );
  }
  if (state.kind === "unavailable") {
    return (
      <main className="mx-auto max-w-xl px-6 py-10 text-[15px] text-text">
        <h1 className="text-xl font-semibold">Appointment bootstrap unavailable</h1>
        <p className="mt-2 text-sm text-secondary-text">Supabase browser client is not configured.</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="mx-auto max-w-xl px-6 py-10 text-[15px] text-text">
        <h1 className="text-xl font-semibold">Appointment bootstrap stopped</h1>
        <p className="mt-2 text-sm text-secondary-text">{state.message}</p>
      </main>
    );
  }

  const showCreate = canShowCreateButton({
    rlsPassed: state.kind !== "rls-fail",
    mappingPassed: state.kind !== "rls-fail",
    timeSafe: true,
    existing: state.kind === "existing",
    conflict: state.kind === "conflict",
  }) && state.kind === "ready";

  return (
    <main className="mx-auto max-w-xl px-6 py-10 text-[15px] leading-relaxed text-text">
      <h1 className="text-xl font-semibold">First Remote Appointment Bootstrap</h1>
      <p className="mt-2 text-sm text-secondary-text">
        Temporary Preview diagnostic. Cookie session only. No token displayed.
        Live Calendar / Today / Treatment / Checkout stay local.
      </p>
      <dl className="mt-8 space-y-3">
        <div>
          <dt className="text-secondary-text">authenticated</dt>
          <dd className="font-medium">yes</dd>
        </div>
        <div>
          <dt className="text-secondary-text">operational staff id</dt>
          <dd className="font-medium">{state.identity.operationalStaffId}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">role</dt>
          <dd className="font-medium">{state.identity.role}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Organization membership</dt>
          <dd className="font-medium">{passFail(state.rls.organizationMembership, true)}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Location access</dt>
          <dd className="font-medium">{passFail(state.rls.locationAccess, true)}</dd>
        </div>
        {state.kind !== "rls-fail" || state.mapping ? (
          <>
            <div>
              <dt className="text-secondary-text">Customer mapping</dt>
              <dd className="font-medium">
                {BOOTSTRAP_TARGET.customerAppId} → {state.mapping.customerDbId}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-text">Service mapping</dt>
              <dd className="font-medium">
                {BOOTSTRAP_TARGET.serviceAppId} → {state.mapping.serviceDbId}
              </dd>
            </div>
            <div>
              <dt className="text-secondary-text">Location mapping</dt>
              <dd className="font-medium">
                {BOOTSTRAP_TARGET.locationAppId} → {state.mapping.locationDbId}
              </dd>
            </div>
          </>
        ) : null}
      </dl>

      {state.kind === "rls-fail" ? (
        <p className="mt-8 text-sm text-secondary-text">
          Precheck did not pass. Create First Remote Appointment is hidden.
        </p>
      ) : null}

      {state.kind === "conflict" ? (
        <p className="mt-8 text-sm text-secondary-text">{APPOINTMENT_STAFF_OVERLAP_MESSAGE}</p>
      ) : null}

      {showCreate ? (
        <section className="mt-8 space-y-3">
          <p className="font-medium">{BOOTSTRAP_TARGET.customerName}</p>
          <p>{BOOTSTRAP_TARGET.serviceName}</p>
          <p>{BOOTSTRAP_TARGET.staffName}</p>
          <p>{BOOTSTRAP_TARGET.locationName}</p>
          <p>
            {display.date}
            <br />
            {display.range}
            <br />
            {display.timezone}
          </p>
          <p>BOOKED</p>
          <button
            type="button"
            className="rounded-md bg-text px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void onCreate()}
          >
            Create First Remote Appointment
          </button>
          {writeError ? <p className="text-sm text-secondary-text">{writeError}</p> : null}
        </section>
      ) : null}

      {state.kind === "existing" ? (
        <p className="mt-8 font-medium">Existing / PASS</p>
      ) : null}
      {state.kind === "created" ? (
        <p className="mt-8 font-medium">Created / PASS</p>
      ) : null}

      {state.kind === "existing" || state.kind === "created" || state.kind === "conflict"
        ? state.appointment && (
        <dl className="mt-6 space-y-3">
          <div>
            <dt className="text-secondary-text">domain app id</dt>
            <dd className="font-medium">{state.appointment.id}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">customer</dt>
            <dd className="font-medium">{state.appointment.customerName || BOOTSTRAP_TARGET.customerName}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">service</dt>
            <dd className="font-medium">{state.appointment.serviceName || BOOTSTRAP_TARGET.serviceName}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">staff</dt>
            <dd className="font-medium">{state.appointment.staffId}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">startAt</dt>
            <dd className="font-medium">{state.appointment.startAt}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">endAt</dt>
            <dd className="font-medium">{state.appointment.endAt}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">status</dt>
            <dd className="font-medium">{state.appointment.status}</dd>
          </div>
        </dl>
        )
        : null}
    </main>
  );
}
