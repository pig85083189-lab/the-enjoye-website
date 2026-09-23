"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import { getServicesForOrganization } from "@/data/mock-services";
import {
  createPackageDefinition,
  deactivatePackageDefinition,
  listPackageDefinitions,
  updatePackageDefinition,
} from "@/lib/packages/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function PackagesPageClient() {
  const { organization, membership } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;
  const staffId = membership?.userId ?? "staff-001";
  const services = getServicesForOrganization(organization.id);
  const definitions = listPackageDefinitions(organization.id);

  const [name, setName] = useState("");
  const [sessions, setSessions] = useState("10");
  const [price, setPrice] = useState("18000");
  const [validity, setValidity] = useState("365");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [error, setError] = useState("");

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">套票定義</h1>
        <p className="mt-1 text-sm text-secondary-text">
          {organization.name} · 堂數以 Ledger 為準，定義修改不影響已售套票快照
        </p>
      </header>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-lg font-medium text-text">新增套票</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="text-sm text-secondary-text">
            名稱
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="美胸保養 10 堂"
            />
          </label>
          <label className="text-sm text-secondary-text">
            適用服務
            <select
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm text-secondary-text">
            堂數
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={sessions}
              onChange={(e) => setSessions(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="text-sm text-secondary-text">
            售價（NT$）
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="text-sm text-secondary-text">
            有效天數（可空）
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-3"
              value={validity}
              onChange={(e) => setValidity(e.target.value)}
              inputMode="numeric"
              placeholder="365"
            />
          </label>
        </div>
        <Button
          className="min-h-11"
          onClick={() => {
            const sessionCount = parseMoneyInput(sessions);
            const priceMinor = parseMoneyInput(price);
            const validityDays = validity.trim()
              ? parseMoneyInput(validity)
              : undefined;
            if (!name.trim() || sessionCount == null || priceMinor == null || !serviceId) {
              setError("請填寫名稱、堂數、售價與服務");
              return;
            }
            try {
              createPackageDefinition(organization.id, {
                name,
                includedServiceIds: [serviceId],
                sessionCount,
                priceMinor,
                validityDays: validityDays ?? undefined,
                createdByStaffId: staffId,
              });
              setName("");
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "無法建立");
            }
          }}
        >
          建立套票
        </Button>
        {error ? (
          <p className="text-sm text-[#B07A4A]" role="alert">
            {error}
          </p>
        ) : null}
      </Card>

      <ul className="space-y-2">
        {definitions.length === 0 ? (
          <Card padding="lg" className="text-sm text-secondary-text">
            尚無套票定義。
          </Card>
        ) : (
          definitions.map((d) => {
            const svcNames = d.includedServices
              .map((s) => services.find((x) => x.id === s.serviceId)?.name ?? s.serviceId)
              .join("、");
            return (
              <li key={d.id}>
                <Card padding="lg" className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-text">
                      {d.name}
                      {!d.isActive ? (
                        <span className="ml-2 text-xs text-secondary-text">（已停用）</span>
                      ) : null}
                    </p>
                    <p className="text-sm text-secondary-text">
                      {d.sessionCount} 堂 · {formatTwd(d.priceMinor)} · {svcNames}
                      {d.validityDays != null ? ` · ${d.validityDays} 天` : ""}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {d.isActive ? (
                      <Button
                        variant="outline"
                        className="min-h-11"
                        onClick={() => {
                          try {
                            deactivatePackageDefinition(organization.id, d.id, staffId);
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "無法停用");
                          }
                        }}
                      >
                        停用
                      </Button>
                    ) : (
                      <Button
                        variant="secondary"
                        className="min-h-11"
                        onClick={() => {
                          try {
                            updatePackageDefinition(
                              organization.id,
                              d.id,
                              { isActive: true },
                              staffId,
                            );
                          } catch (err) {
                            setError(err instanceof Error ? err.message : "無法啟用");
                          }
                        }}
                      >
                        重新啟用
                      </Button>
                    )}
                  </div>
                </Card>
              </li>
            );
          })
        )}
      </ul>
    </div>
  );
}
