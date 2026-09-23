"use client";

import { useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  addCheckoutItem,
  createEmptyCheckoutDraft,
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import {
  PACKAGE_LEDGER_TYPE_LABEL,
} from "@/lib/packages/domain";
import {
  adjustPackageSessions,
  getPackageUsableBalance,
  listCustomerPackages,
  listPackageDefinitions,
  listPackageLedger,
} from "@/lib/packages/store";
import {
  STORED_VALUE_LEDGER_TYPE_LABEL,
} from "@/lib/stored-value/domain";
import {
  adjustStoredValue,
  getCustomerStoredValueBalance,
  listStoredValueLedger,
} from "@/lib/stored-value/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import { cn } from "@/lib/utils";

interface WalletTabProps {
  customerId: string;
}

export function WalletTab({ customerId }: WalletTabProps) {
  const router = useRouter();
  const { organization, currentLocation, locations, membership } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;
  const staffId = membership?.userId ?? "staff-001";
  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";

  const svBalance = getCustomerStoredValueBalance(organization.id, customerId);
  const packages = listCustomerPackages(organization.id, { customerId });
  const definitions = listPackageDefinitions(organization.id, { activeOnly: true });
  const svLedger = listStoredValueLedger(organization.id, { customerId });

  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [topUp, setTopUp] = useState("10000");
  const [adjReason, setAdjReason] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [pkgAdjDelta, setPkgAdjDelta] = useState("1");
  const [error, setError] = useState("");

  function startPackagePurchase(definitionId: string) {
    setError("");
    try {
      const draft = createEmptyCheckoutDraft(organization.id, {
        locationId,
        customerId,
        createdByStaffId: staffId,
      });
      addCheckoutItem(organization.id, draft.id, {
        type: "PACKAGE_PURCHASE",
        referenceId: definitionId,
        name: "",
        unitPrice: 0,
      });
      router.push(`/staff/checkout?draft=${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立購買結帳");
    }
  }

  function startTopUp() {
    setError("");
    const amount = parseMoneyInput(topUp);
    if (amount == null || amount <= 0) {
      setError("儲值金額須為正整數");
      return;
    }
    try {
      const draft = createEmptyCheckoutDraft(organization.id, {
        locationId,
        customerId,
        createdByStaffId: staffId,
      });
      addCheckoutItem(organization.id, draft.id, {
        type: "STORED_VALUE_TOP_UP",
        name: "儲值",
        unitPrice: amount,
      });
      router.push(`/staff/checkout?draft=${draft.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "無法建立儲值結帳");
    }
  }

  const detailPkg = selectedPkg
    ? packages.find((p) => p.id === selectedPkg)
    : null;
  const detailLedger = selectedPkg
    ? listPackageLedger(organization.id, { customerPackageId: selectedPkg })
    : [];

  return (
    <div className="space-y-4">
      {error ? (
        <p className="text-sm text-[#B07A4A]" role="alert">
          {error}
        </p>
      ) : null}

      <Card padding="lg" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-medium text-text">儲值金</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-text">
              {formatTwd(svBalance)}
            </p>
            <p className="text-xs text-secondary-text">餘額由 Ledger 加總 · 組織共用</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-sm text-secondary-text">
              儲值金額
              <input
                className="mt-1 min-h-11 w-32 rounded-2xl border border-border px-3"
                value={topUp}
                onChange={(e) => setTopUp(e.target.value)}
                inputMode="numeric"
              />
            </label>
            <Button className="min-h-11" onClick={startTopUp}>
              儲值
            </Button>
          </div>
        </div>

        {(membership?.role === "OWNER" || membership?.role === "MANAGER") && (
          <div className="flex flex-wrap gap-2 border-t border-border pt-3">
            <input
              className="min-h-11 w-28 rounded-2xl border border-border px-3 text-sm"
              value={adjAmount}
              onChange={(e) => setAdjAmount(e.target.value)}
              placeholder="±金額"
              inputMode="numeric"
              aria-label="調整金額"
            />
            <input
              className="min-h-11 min-w-[10rem] flex-1 rounded-2xl border border-border px-3 text-sm"
              value={adjReason}
              onChange={(e) => setAdjReason(e.target.value)}
              placeholder="調整原因（必填）"
              aria-label="調整原因"
            />
            <Button
              variant="outline"
              className="min-h-11"
              onClick={() => {
                const delta = Number(adjAmount);
                if (!Number.isInteger(delta) || delta === 0 || !adjReason.trim()) {
                  setError("調整需整數金額與原因");
                  return;
                }
                try {
                  adjustStoredValue(organization.id, {
                    customerId,
                    amountDelta: delta,
                    reason: adjReason,
                    locationId,
                    createdByStaffId: staffId,
                  });
                  setAdjAmount("");
                  setAdjReason("");
                  setError("");
                } catch (err) {
                  setError(err instanceof Error ? err.message : "調整失敗");
                }
              }}
            >
              調整儲值
            </Button>
          </div>
        )}

        <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
          {svLedger.length === 0 ? (
            <li className="text-secondary-text">尚無儲值紀錄</li>
          ) : (
            [...svLedger].reverse().map((e) => (
              <li
                key={e.id}
                className="flex flex-wrap justify-between gap-2 border-b border-border/50 py-1.5"
              >
                <span>
                  {STORED_VALUE_LEDGER_TYPE_LABEL[e.type]}
                  {e.reason ? ` · ${e.reason}` : ""}
                  <span className="ml-2 text-xs text-secondary-text">
                    {formatYmd(new Date(e.createdAt))} {formatHm(new Date(e.createdAt))}
                  </span>
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    e.amountDelta >= 0 ? "text-text" : "text-secondary-text",
                  )}
                >
                  {e.amountDelta >= 0 ? "+" : ""}
                  {formatTwd(e.amountDelta)}
                </span>
              </li>
            ))
          )}
        </ul>
      </Card>

      <Card padding="lg" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-medium text-text">套票</h2>
        </div>
        {definitions.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {definitions.map((d) => (
              <Button
                key={d.id}
                variant="secondary"
                className="min-h-11"
                onClick={() => startPackagePurchase(d.id)}
              >
                購買 {d.name}（{formatTwd(d.priceMinor)}）
              </Button>
            ))}
          </div>
        ) : (
          <p className="text-sm text-secondary-text">
            尚無可售套票。請先至{" "}
            <Link href="/staff/packages" className="text-primary">
              套票管理
            </Link>{" "}
            建立。
          </p>
        )}

        <ul className="space-y-2">
          {packages.length === 0 ? (
            <li className="text-sm text-secondary-text">尚無客戶套票</li>
          ) : (
            packages.map((pkg) => {
              const bal = getPackageUsableBalance(organization.id, pkg.id);
              return (
                <li key={pkg.id}>
                  <button
                    type="button"
                    onClick={() =>
                      setSelectedPkg((id) => (id === pkg.id ? null : pkg.id))
                    }
                    className="min-h-11 w-full rounded-2xl border border-border bg-surface px-4 py-3 text-left"
                  >
                    <p className="font-medium text-text">{pkg.nameSnapshot}</p>
                    <p className="text-sm text-secondary-text">
                      剩餘 {bal.usableBalance} / {pkg.sessionCountSnapshot}（Ledger{" "}
                      {bal.ledgerBalance}）· {bal.status}
                      {pkg.expiresAt
                        ? ` · 至 ${formatYmd(new Date(pkg.expiresAt))}`
                        : ""}
                    </p>
                  </button>
                </li>
              );
            })
          )}
        </ul>
      </Card>

      {detailPkg ? (
        <Card padding="lg" className="space-y-3">
          <h3 className="font-medium text-text">{detailPkg.nameSnapshot} · 明細</h3>
          <p className="text-sm text-secondary-text">
            購買 {formatYmd(new Date(detailPkg.purchasedAt))} · 快照價{" "}
            {formatTwd(detailPkg.priceSnapshot)}
            {detailPkg.purchaseTransactionId ? (
              <>
                {" "}
                ·{" "}
                <Link
                  href={`/staff/transactions?id=${detailPkg.purchaseTransactionId}`}
                  className="text-primary"
                >
                  交易
                </Link>
              </>
            ) : null}
          </p>
          {(membership?.role === "OWNER" || membership?.role === "MANAGER") && (
            <div className="flex flex-wrap gap-2">
              <input
                className="min-h-11 w-20 rounded-2xl border border-border px-2 text-sm"
                value={pkgAdjDelta}
                onChange={(e) => setPkgAdjDelta(e.target.value)}
                aria-label="堂數調整"
              />
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  const delta = Number(pkgAdjDelta);
                  if (!Number.isInteger(delta) || delta === 0) {
                    setError("堂數調整須為非零整數");
                    return;
                  }
                  try {
                    adjustPackageSessions(organization.id, {
                      customerPackageId: detailPkg.id,
                      sessionDelta: delta,
                      reason: "手動調整",
                      locationId,
                      createdByStaffId: staffId,
                    });
                    setError("");
                  } catch (err) {
                    setError(err instanceof Error ? err.message : "調整失敗");
                  }
                }}
              >
                調整堂數
              </Button>
            </div>
          )}
          <ul className="space-y-1 text-sm">
            {[...detailLedger].reverse().map((e) => (
              <li key={e.id} className="flex justify-between gap-2 border-b border-border/50 py-1.5">
                <span>
                  {PACKAGE_LEDGER_TYPE_LABEL[e.type]}
                  {e.serviceId ? ` · ${e.serviceId}` : ""}
                  <span className="ml-2 text-xs text-secondary-text">
                    {formatYmd(new Date(e.createdAt))}
                  </span>
                </span>
                <span className="tabular-nums">
                  {e.sessionDelta > 0 ? "+" : ""}
                  {e.sessionDelta} 堂
                </span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </div>
  );
}
