"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { CustomerRemoteAdapter } from "@/lib/persistence/customer-remote-adapter";
import type { CanonicalIdMapper } from "@/lib/persistence/identity-map";
import {
  CUSTOMER_BOOTSTRAP_ROUTE,
  FIRST_REMOTE_CUSTOMER_PAYLOAD,
  createFirstRemoteQaCustomer,
  findExistingRemoteQaCustomer,
  loadCustomerBootstrapContext,
  type BootstrapIdentityView,
  type BootstrapRlsCheck,
  type CustomerBootstrapClient,
  type CustomerMappingView,
} from "@/lib/staff-auth/customer-bootstrap";
import type { Customer } from "@/types";

function passFail(value: boolean | null, expected?: boolean): string {
  if (value === true) return expected === false ? "FAIL" : "PASS";
  if (value === false) return expected === false ? "PASS" : "FAIL";
  return "NOT VERIFIED";
}

function roleLabel(role: string | null): string {
  return role ?? "—";
}

type ReadyState = {
  kind: "ready" | "existing" | "created";
  identity: BootstrapIdentityView;
  rls: BootstrapRlsCheck;
  customer?: Customer;
  mapping?: CustomerMappingView;
};

type PageState =
  | { kind: "loading" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "rls-fail"; identity: BootstrapIdentityView; rls: BootstrapRlsCheck }
  | ReadyState;

export function CustomerBootstrapClient() {
  const router = useRouter();
  const sessionRef = useRef<{
    adapter: CustomerRemoteAdapter;
    mapper: CanonicalIdMapper;
  } | null>(null);
  const [state, setState] = useState<PageState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function boot() {
      const supabase = createBrowserClientOrNull();
      if (!supabase) {
        if (!cancelled) setState({ kind: "unavailable" });
        return;
      }
      const { data } = await supabase.auth.getUser();
      if (!data.user) {
        router.replace(`/staff/login?next=${encodeURIComponent(CUSTOMER_BOOTSTRAP_ROUTE)}`);
        return;
      }
      try {
        const client = supabase as unknown as CustomerBootstrapClient;
        const ctx = await loadCustomerBootstrapContext(client);
        if (cancelled) return;
        sessionRef.current = { adapter: ctx.adapter, mapper: ctx.mapper };
        if (!ctx.rlsPassed) {
          setState({ kind: "rls-fail", identity: ctx.identity, rls: ctx.rls });
          return;
        }
        const existing = await findExistingRemoteQaCustomer(ctx.adapter);
        if (cancelled) return;
        if (existing) {
          const created = await createFirstRemoteQaCustomer(ctx.adapter, ctx.mapper);
          setState({
            kind: "existing",
            identity: ctx.identity,
            rls: ctx.rls,
            customer: created.customer,
            mapping: created.mapping,
          });
          return;
        }
        setState({ kind: "ready", identity: ctx.identity, rls: ctx.rls });
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Bootstrap failed";
        if (message === "unauthenticated") {
          router.replace(`/staff/login?next=${encodeURIComponent(CUSTOMER_BOOTSTRAP_ROUTE)}`);
          return;
        }
        setState({ kind: "error", message });
      }
    }
    void boot();
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
      const result = await createFirstRemoteQaCustomer(session.adapter, session.mapper);
      setState({
        kind: result.status === "existing" ? "existing" : "created",
        identity: state.identity,
        rls: state.rls,
        customer: result.customer,
        mapping: result.mapping,
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
        <h1 className="text-xl font-semibold">Customer bootstrap unavailable</h1>
        <p className="mt-2 text-sm text-secondary-text">Supabase browser client is not configured.</p>
      </main>
    );
  }
  if (state.kind === "error") {
    return (
      <main className="mx-auto max-w-xl px-6 py-10 text-[15px] text-text">
        <h1 className="text-xl font-semibold">Customer bootstrap stopped</h1>
        <p className="mt-2 text-sm text-secondary-text">{state.message}</p>
      </main>
    );
  }

  const showCreate = state.kind === "ready";
  const customer = state.kind === "existing" || state.kind === "created" ? state.customer : undefined;
  const mapping = state.kind === "existing" || state.kind === "created" ? state.mapping : undefined;

  return (
    <main className="mx-auto max-w-xl px-6 py-10 text-[15px] leading-relaxed text-text">
      <h1 className="text-xl font-semibold">First Remote Customer Bootstrap</h1>
      <p className="mt-2 text-sm text-secondary-text">
        Temporary Preview diagnostic. Cookie session only. No token displayed.
        Live Customer UI stays local.
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
          <dt className="text-secondary-text">organization app id</dt>
          <dd className="font-medium">{state.identity.organizationAppId}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">location app id</dt>
          <dd className="font-medium">{state.identity.locationAppId}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Organization membership</dt>
          <dd className="font-medium">{passFail(state.rls.organizationMembership, true)}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Organization role</dt>
          <dd className="font-medium">{roleLabel(state.rls.organizationRole)}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Location access</dt>
          <dd className="font-medium">{passFail(state.rls.locationAccess, true)}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Unrelated organization</dt>
          <dd className="font-medium">{passFail(state.rls.unrelatedOrganizationMembership, false)}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">Unrelated location</dt>
          <dd className="font-medium">{passFail(state.rls.unrelatedLocationAccess, false)}</dd>
        </div>
      </dl>

      {state.kind === "rls-fail" ? (
        <p className="mt-8 text-sm text-secondary-text">
          RLS precheck did not pass. Create Customer is hidden.
        </p>
      ) : null}

      {showCreate ? (
        <section className="mt-8 space-y-3">
          <p className="text-sm text-secondary-text">
            Payload: {FIRST_REMOTE_CUSTOMER_PAYLOAD.name} / {FIRST_REMOTE_CUSTOMER_PAYLOAD.phone} /
            {FIRST_REMOTE_CUSTOMER_PAYLOAD.organizationId} / {FIRST_REMOTE_CUSTOMER_PAYLOAD.primaryStaffId}
          </p>
          <button
            type="button"
            className="rounded-md bg-text px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            disabled={busy}
            onClick={() => void onCreate()}
          >
            Create First Remote Customer
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

      {customer && mapping ? (
        <dl className="mt-6 space-y-3">
          <div>
            <dt className="text-secondary-text">domain app id</dt>
            <dd className="font-medium">{customer.id}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">database UUID</dt>
            <dd className="font-medium">{mapping.databaseUuid}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">mapping reverse</dt>
            <dd className="font-medium">{mapping.reverseAppId}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">organization</dt>
            <dd className="font-medium">{customer.organizationId}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">primary staff</dt>
            <dd className="font-medium">{customer.primaryStaffId ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">name</dt>
            <dd className="font-medium">{customer.name}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">phone</dt>
            <dd className="font-medium">{customer.phone}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">totalVisits</dt>
            <dd className="font-medium">{customer.totalVisits}</dd>
          </div>
          <div>
            <dt className="text-secondary-text">packages</dt>
            <dd className="font-medium">{customer.packages.length === 0 ? "none" : String(customer.packages.length)}</dd>
          </div>
        </dl>
      ) : null}
    </main>
  );
}
