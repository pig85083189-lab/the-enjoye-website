"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  loadLineCustomerBindings,
  startLineCustomerBindAction,
  unbindLineCustomerBindingAction,
} from "@/lib/line/automations/customer-binding-actions";
import {
  isTrustedCustomerBinding,
  type LineCustomerBindingRow,
} from "@/lib/line/automations/customer-bindings";
import {
  LINE_CUSTOMER_BIND_ACTIVE,
  LINE_CUSTOMER_BIND_EMPTY,
  LINE_CUSTOMER_BIND_HINT,
  LINE_CUSTOMER_BIND_NO_EDIT,
  LINE_CUSTOMER_BIND_PENDING,
  LINE_CUSTOMER_BIND_RELEASED,
  LINE_CUSTOMER_BIND_START,
  LINE_CUSTOMER_BIND_TITLE,
  LINE_CUSTOMER_BIND_UNBIND,
  LINE_CUSTOMER_BIND_UNBOUND,
} from "@/lib/line/automations/copy";
import { shouldApplyLineAutomationClientResult } from "@/lib/line/automations/rules";

function bindingStatusLabel(row: LineCustomerBindingRow): string {
  if (isTrustedCustomerBinding(row.binding)) return LINE_CUSTOMER_BIND_ACTIVE;
  if (row.binding?.status === "unbound") return LINE_CUSTOMER_BIND_RELEASED;
  if (row.binding?.status === "pending") return LINE_CUSTOMER_BIND_PENDING;
  return LINE_CUSTOMER_BIND_UNBOUND;
}

export function LineCustomerBindingsCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const [customers, setCustomers] = useState<LineCustomerBindingRow[]>([]);
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [message, setMessage] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const activeOrganizationId = useRef(organizationId);
  activeOrganizationId.current = organizationId;

  useEffect(() => {
    const requestOrganizationId = organizationId;
    let cancelled = false;
    setCodes({});
    setMessage("");
    void loadLineCustomerBindings(requestOrganizationId).then((result) => {
      if (cancelled) return;
      if (
        !shouldApplyLineAutomationClientResult({
          requestOrganizationId,
          activeOrganizationId: activeOrganizationId.current,
        })
      ) {
        return;
      }
      if (!result.ok || !result.data) {
        setCustomers([]);
        setMessage(result.ok ? "" : result.message);
        return;
      }
      setCustomers(result.data.customers);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function refresh(requestOrganizationId: string) {
    const loaded = await loadLineCustomerBindings(requestOrganizationId);
    if (
      !shouldApplyLineAutomationClientResult({
        requestOrganizationId,
        activeOrganizationId: activeOrganizationId.current,
      })
    ) {
      return;
    }
    if (!loaded.ok || !loaded.data) {
      setMessage(loaded.ok ? "" : loaded.message);
      return;
    }
    setCustomers(loaded.data.customers);
  }

  async function handleStart(customerId: string) {
    if (busyId) return;
    const requestOrganizationId = organizationId;
    setBusyId(customerId);
    setMessage("");
    try {
      const result = await startLineCustomerBindAction({
        organizationId: requestOrganizationId,
        customerId,
      });
      if (
        !shouldApplyLineAutomationClientResult({
          requestOrganizationId,
          activeOrganizationId: activeOrganizationId.current,
        })
      ) {
        return;
      }
      setMessage(result.message);
      if (result.ok && result.data) {
        setCodes((current) => ({ ...current, [result.data!.customerId]: result.data!.code }));
      }
    } finally {
      if (busyId === customerId || activeOrganizationId.current === requestOrganizationId) {
        setBusyId(null);
      }
    }
  }

  async function handleUnbind(customerId: string) {
    if (busyId) return;
    const requestOrganizationId = organizationId;
    setBusyId(customerId);
    setMessage("");
    try {
      const result = await unbindLineCustomerBindingAction({
        organizationId: requestOrganizationId,
        customerId,
      });
      if (
        !shouldApplyLineAutomationClientResult({
          requestOrganizationId,
          activeOrganizationId: activeOrganizationId.current,
        })
      ) {
        return;
      }
      setMessage(result.message);
      if (result.ok) {
        setCodes((current) => {
          const next = { ...current };
          delete next[customerId];
          return next;
        });
        await refresh(requestOrganizationId);
      }
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Card data-line-customer-bindings padding="lg" className="space-y-3">
      <div>
        <h2 className="text-[16px] font-semibold text-text">{LINE_CUSTOMER_BIND_TITLE}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">
          {LINE_CUSTOMER_BIND_HINT}
        </p>
        <p className="mt-1 text-[12px] text-secondary-text">{LINE_CUSTOMER_BIND_NO_EDIT}</p>
      </div>
      {customers.length === 0 ? (
        <p className="text-[13px] text-secondary-text">{LINE_CUSTOMER_BIND_EMPTY}</p>
      ) : (
        <ul className="space-y-2">
          {customers.map((row) => {
            const trusted = isTrustedCustomerBinding(row.binding);
            return (
              <li
                key={row.customerId}
                data-line-customer-binding={row.customerId}
                data-line-customer-binding-verified={trusted ? "true" : "false"}
                className="rounded-2xl bg-white px-4 py-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-text">{row.displayName}</p>
                    <p className="mt-1 text-[13px] text-secondary-text">
                      {bindingStatusLabel(row)}
                      {row.binding?.hint ? ` · ${row.binding.hint}` : ""}
                    </p>
                    {codes[row.customerId] ? (
                      <p
                        className="mt-2 rounded-2xl bg-primary-light/50 px-3 py-2 font-mono text-[16px] tracking-[0.2em]"
                        data-line-customer-bind-code={row.customerId}
                      >
                        {codes[row.customerId]}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      disabled={busyId !== null}
                      data-line-customer-bind-start={row.customerId}
                      onClick={() => {
                        void handleStart(row.customerId);
                      }}
                    >
                      {LINE_CUSTOMER_BIND_START}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      disabled={busyId !== null || !trusted}
                      data-line-customer-bind-unbind={row.customerId}
                      onClick={() => {
                        void handleUnbind(row.customerId);
                      }}
                    >
                      {LINE_CUSTOMER_BIND_UNBIND}
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {message ? (
        <p className="text-[13px] text-secondary-text" data-line-customer-bind-message>
          {message}
        </p>
      ) : null}
    </Card>
  );
}
