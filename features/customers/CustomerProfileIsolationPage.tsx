"use client";

import { Component, useEffect, useLayoutEffect, useState, type ComponentType, type ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import {
  sanitizeDiagnosticError,
  sanitizeDiagnosticText,
  type SanitizedError,
} from "@/lib/appointments/appointment-read-diagnostic";
import {
  APPOINTMENT_READ_DIAGNOSTIC_ROUTE,
  CUSTOMER_PROFILE_ISOLATION_ROUTE,
} from "@/lib/appointments/appointment-read-diagnostic-flag";

type IsolationStageId = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";
type IsolationStatus = "WAIT" | "PASS" | "FAIL";

type CapturedClientError = SanitizedError & { source: "onerror" | "unhandledrejection" };

type StageSpec = {
  id: IsolationStageId;
  label: string;
  load: () => Promise<ComponentType>;
};

const STAGES: StageSpec[] = [
  {
    id: "A",
    label: "Customer shell only",
    load: async () => (await import("./isolation/stage-a-shell")).default,
  },
  {
    id: "B",
    label: "CustomerProfilePage shell",
    load: async () => (await import("./isolation/stage-profile")).StageBProfileShell,
  },
  {
    id: "C",
    label: "Customer360Workspace without tabs",
    load: async () => (await import("./isolation/stage-profile")).StageCWorkspace,
  },
  {
    id: "D",
    label: "Customer360Workspace + tabs navigation",
    load: async () => (await import("./isolation/stage-profile")).StageDTabs,
  },
  {
    id: "E",
    label: "AppointmentsTab shell only",
    load: async () => (await import("./isolation/stage-appointments")).StageEAppointmentsShell,
  },
  {
    id: "F",
    label: "AppointmentsTab with remote state but no appointment row",
    load: async () => (await import("./isolation/stage-appointments")).StageFAppointmentsEmpty,
  },
  {
    id: "G",
    label: "AppointmentsTab with one remote appointment row",
    load: async () => (await import("./isolation/stage-appointments")).StageGAppointmentsRemoteRow,
  },
  {
    id: "H",
    label: "Full appointment row/card",
    load: async () => (await import("./isolation/stage-appointments")).StageHAppointmentCard,
  },
  {
    id: "I",
    label: "Full original Customer Profile appointments tab",
    load: async () => (await import("./isolation/stage-profile")).StageIFullAppointments,
  },
];

class IsolationErrorBoundary extends Component<
  { label: string; children: ReactNode; onFail: (error: SanitizedError) => void },
  { error: SanitizedError | null }
> {
  state: { error: SanitizedError | null } = { error: null };

  static getDerivedStateFromError(error: unknown): { error: SanitizedError } {
    return { error: sanitizeDiagnosticError(error) };
  }

  componentDidCatch(error: unknown) {
    this.props.onFail(sanitizeDiagnosticError(error));
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mt-3 space-y-1 text-sm text-secondary-text">
          <p>{this.props.label} render FAIL</p>
          <p>{this.state.error.name}</p>
          <p>{this.state.error.message}</p>
          {this.state.error.stackLocation ? <p>{this.state.error.stackLocation}</p> : null}
        </div>
      );
    }
    return this.props.children;
  }
}

function IsolationStageCard({ spec }: { spec: StageSpec }) {
  const [status, setStatus] = useState<IsolationStatus>("WAIT");
  const [error, setError] = useState<SanitizedError | null>(null);
  const [View, setView] = useState<ComponentType | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await spec.load();
        if (cancelled) return;
        setView(() => next);
        setStatus("PASS");
      } catch (caught: unknown) {
        if (cancelled) return;
        setError(sanitizeDiagnosticError(caught));
        setStatus("FAIL");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spec]);

  return (
    <Card padding="md" data-isolation-stage={spec.id} data-isolation-status={status}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs text-secondary-text">Stage {spec.id}</p>
          <p className="mt-1 font-medium text-text">{spec.label}</p>
        </div>
        <span className="shrink-0 rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
          {status}
        </span>
      </div>
      {error ? (
        <div className="mt-3 space-y-1 text-sm text-secondary-text">
          <p>{error.name}</p>
          <p>{error.message}</p>
          {error.stackLocation ? <p>{error.stackLocation}</p> : null}
        </div>
      ) : null}
      {View ? (
        <div className="mt-3 overflow-hidden rounded-2xl border border-border p-3">
          <IsolationErrorBoundary
            label={`Stage ${spec.id}`}
            onFail={(next) => {
              setError(next);
              setStatus("FAIL");
            }}
          >
            <View />
          </IsolationErrorBoundary>
        </div>
      ) : null}
    </Card>
  );
}

export function CustomerProfileIsolationPage() {
  const [clientErrors, setClientErrors] = useState<CapturedClientError[]>([]);

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

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 pb-16">
      <header className="space-y-2">
        <p className="text-xs text-secondary-text">TEMPORARY Preview isolation</p>
        <h1 className="text-xl font-semibold text-text">Customer Profile component isolation</h1>
        <p className="text-sm text-secondary-text">
          Route {CUSTOMER_PROFILE_ISOLATION_ROUTE}. Same Owner session as{" "}
          {APPOINTMENT_READ_DIAGNOSTIC_ROUTE}. No writes. Production unavailable.
        </p>
        <p className="text-sm text-secondary-text">
          Each stage has its own Error Boundary. A FAIL here must not become Next.js global-error.
          Keep /staff/appointment-read-diagnostic until Live Verified.
        </p>
      </header>

      {clientErrors.length > 0 ? (
        <Card padding="md" data-isolation-client-errors>
          <p className="font-medium text-text">Captured browser errors</p>
          <div className="mt-3 space-y-3">
            {clientErrors.map((error, index) => (
              <div key={`${error.source}-${index}`} className="text-sm text-secondary-text">
                <p>{error.source}</p>
                <p>{sanitizeDiagnosticText(error.name)}</p>
                <p>{error.message}</p>
                {error.stackLocation ? <p>{error.stackLocation}</p> : null}
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      {STAGES.map((spec) => (
        <IsolationStageCard key={spec.id} spec={spec} />
      ))}
    </div>
  );
}
