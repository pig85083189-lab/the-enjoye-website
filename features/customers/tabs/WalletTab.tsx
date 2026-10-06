"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
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
import type { Transaction } from "@/lib/commerce/domain";
import { formatTwd, parseMoneyInput } from "@/lib/commerce/money";
import { listTransactions } from "@/lib/commerce/transaction-store";
import {
  deriveRecentTransactions,
  PACKAGE_STATUS_LABEL,
  resolveCustomer360Transactions,
} from "@/lib/customers/customer-360";
import {
  PACKAGE_LEDGER_TYPE_LABEL,
} from "@/lib/packages/domain";
import {
  deriveCustomerPackageStatus,
} from "@/lib/packages/domain";
import { usedSessionsForCustomerPackage } from "@/lib/packages/package-eligibility";
import {
  rowsFromPackageRemoteState,
  usePackageRemoteCustomerPackages,
  usePackageRemoteDefinitions,
  usePackageRemoteLedger,
} from "@/features/packages/use-package-remote-read";
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
  section?: "packages" | "stored-value";
  onOpenTransactions?: () => void;
  commerceRemoteRead?: boolean;
  packageRemoteRead?: boolean;
  remoteTransactions?: Transaction[] | null;
}

export function WalletTab({
  customerId,
  section,
  onOpenTransactions,
  commerceRemoteRead = false,
  packageRemoteRead = false,
  remoteTransactions = null,
}: WalletTabProps) {
  const router = useRouter();
  const { organization, currentLocation, locations, membership } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;
  const staffId = membership?.userId ?? "staff-001";
  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const canAdjust =
    !commerceRemoteRead &&
    (membership?.role === "OWNER" || membership?.role === "MANAGER");

  const remotePackages = usePackageRemoteCustomerPackages(
    organization.id,
    packageRemoteRead,
    customerId,
  );
  const remoteLedger = usePackageRemoteLedger(organization.id, packageRemoteRead, customerId);
  const remoteDefinitions = usePackageRemoteDefinitions(organization.id, packageRemoteRead);
  const svBalance = commerceRemoteRead
    ? 0
    : getCustomerStoredValueBalance(organization.id, customerId);
  const packages = packageRemoteRead
    ? rowsFromPackageRemoteState(remotePackages)
    : commerceRemoteRead
      ? []
      : listCustomerPackages(organization.id, { customerId });
  const definitions = packageRemoteRead
    ? rowsFromPackageRemoteState(remoteDefinitions)
    : commerceRemoteRead
      ? []
      : listPackageDefinitions(organization.id, { activeOnly: true });
  const svLedger = commerceRemoteRead
    ? []
    : listStoredValueLedger(organization.id, { customerId });
  const remoteLedgerRows = rowsFromPackageRemoteState(remoteLedger);
  const recentTx = deriveRecentTransactions(
    resolveCustomer360Transactions(
      commerceRemoteRead ? (remoteTransactions ?? []) : null,
      listTransactions(organization.id, { customerId }),
    ),
  );
  const recentLedger = [...svLedger].reverse().slice(0, 3);

  const [selectedPkg, setSelectedPkg] = useState<string | null>(null);
  const [topUp, setTopUp] = useState("");
  const [adjReason, setAdjReason] = useState("");
  const [adjAmount, setAdjAmount] = useState("");
  const [pkgAdjDelta, setPkgAdjDelta] = useState("1");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!section) return;
    const id =
      section === "packages" ? "customer-wallet-packages" : "customer-wallet-stored-value";
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [section]);

  function startPackagePurchase(definitionId: string) {
    if (commerceRemoteRead) return;
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
    if (commerceRemoteRead) return;
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
    <div
      className="space-y-5"
      data-customer-wallet-source={
        packageRemoteRead ? "package-remote-pilot" : commerceRemoteRead ? "remote-pilot" : "local"
      }
      data-customer-wallet-mode={
        commerceRemoteRead || packageRemoteRead ? "readonly" : "local-write"
      }
    >
      {error ? (
        <p className="text-sm text-[#B07A4A]" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <h2 className="text-[15px] font-semibold text-text">財務總覽</h2>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
          <div>
            <dt className="text-xs text-secondary-text">套票</dt>
            <dd className="mt-0.5 text-[15px] tabular-nums text-text">{packages.length} 張</dd>
          </div>
          <div>
            <dt className="text-xs text-secondary-text">儲值</dt>
            <dd className="mt-0.5 text-[15px] tabular-nums text-text">{formatTwd(svBalance)}</dd>
          </div>
          {recentTx.length > 0 ? (
            <div>
              <dt className="text-xs text-secondary-text">最近一筆</dt>
              <dd className="mt-0.5 text-[15px] tabular-nums text-text">
                {formatTwd(recentTx[0].totalMinor)}
              </dd>
            </div>
          ) : null}
        </dl>
      </div>

      <Card padding="md" className="space-y-3" id="customer-wallet-packages">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-text">套票</h3>
          {commerceRemoteRead && !packageRemoteRead ? (
            <span className="text-xs text-secondary-text">尚未開放</span>
          ) : (
            <Link
              href="/staff/packages"
              className="text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              查看套票
            </Link>
          )}
        </div>
        {packages.length === 0 ? (
          <p className="text-sm text-secondary-text">尚無套票</p>
        ) : (
          <ul className="space-y-2">
            {packages.map((pkg) => {
              const bal = packageRemoteRead
                ? (() => {
                    const ledgerBalance = remoteLedgerRows
                      .filter((entry) => entry.customerPackageId === pkg.id)
                      .reduce((sum, entry) => sum + entry.sessionDelta, 0);
                    const status = deriveCustomerPackageStatus(pkg, ledgerBalance);
                    return {
                      ledgerBalance,
                      usableBalance:
                        status === "ACTIVE" && ledgerBalance > 0 ? ledgerBalance : 0,
                      status,
                    };
                  })()
                : getPackageUsableBalance(organization.id, pkg.id);
              const usedSessions = usedSessionsForCustomerPackage(
                pkg,
                bal.ledgerBalance,
              );
              return (
                <li key={pkg.id}>
                  <button
                    type="button"
                    data-customer-wallet-package={pkg.id}
                    onClick={() =>
                      setSelectedPkg((id) => (id === pkg.id ? null : pkg.id))
                    }
                    className="min-h-11 w-full rounded-2xl border border-border bg-surface px-4 py-2.5 text-left"
                  >
                    <p className="text-[14px] font-medium text-text">{pkg.nameSnapshot}</p>
                    <p className="mt-0.5 text-xs text-secondary-text">
                      總堂數 {pkg.sessionCountSnapshot} · 剩餘 {bal.usableBalance} 堂 · 已使用{" "}
                      {usedSessions} 堂
                      {pkg.expiresAt ? ` · 至 ${formatYmd(new Date(pkg.expiresAt))}` : ""}
                      <span className="mx-1 text-border">·</span>
                      {PACKAGE_STATUS_LABEL[bal.status] ?? bal.status}
                    </p>
                    <p className="mt-0.5 text-xs text-secondary-text">
                      購買 {formatYmd(new Date(pkg.purchasedAt))}
                    </p>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {commerceRemoteRead && !packageRemoteRead ? (
          <p className="text-sm text-secondary-text">套票尚未開放</p>
        ) : packageRemoteRead ? (
          <p className="text-xs text-secondary-text">
            正式套票讀取自遠端帳本。購買請至套票管理，尚未付款不會建立堂數。
          </p>
        ) : definitions.length > 0 ? (
          <details className="rounded-2xl border border-border/80 bg-[#FBF4F3]/40 px-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-secondary-text [&::-webkit-details-marker]:hidden">
              購買套票
            </summary>
            <div className="flex flex-wrap gap-2 pb-3">
              {definitions.map((d) => (
                <Button
                  key={d.id}
                  variant="secondary"
                  className="min-h-11"
                  onClick={() => startPackagePurchase(d.id)}
                >
                  {d.name}（{formatTwd(d.priceMinor)}）
                </Button>
              ))}
            </div>
          </details>
        ) : (
          <p className="text-xs text-secondary-text">
            尚無可售套票。請先至{" "}
            <Link href="/staff/packages" className="font-medium text-primary">
              套票管理
            </Link>{" "}
            建立。
          </p>
        )}
      </Card>

      {detailPkg ? (
        <Card padding="md" className="space-y-3">
          <h3 className="text-[15px] font-medium text-text">{detailPkg.nameSnapshot} · 明細</h3>
          <p className="text-xs text-secondary-text">
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
          {canAdjust ? (
            <details className="rounded-2xl border border-border/80 px-3">
              <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs text-secondary-text [&::-webkit-details-marker]:hidden">
                調整堂數（管理）
              </summary>
              <div className="flex flex-wrap gap-2 pb-3">
                <input
                  className="min-h-11 w-20 rounded-2xl border border-border px-2 text-sm"
                  value={pkgAdjDelta}
                  onChange={(e) => setPkgAdjDelta(e.target.value)}
                  aria-label="堂數調整"
                />
                <Button
                  variant="ghost"
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
                  確認調整
                </Button>
              </div>
            </details>
          ) : null}
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

      <Card padding="md" className="space-y-4" id="customer-wallet-stored-value">
        <div>
          <h3 className="text-[15px] font-semibold text-text">儲值金</h3>
          <p className="mt-2 text-[28px] font-semibold leading-none tabular-nums tracking-tight text-text">
            {formatTwd(svBalance)}
          </p>
          <p className="mt-1.5 text-xs text-secondary-text">可用餘額</p>
        </div>

        {recentLedger.length > 0 ? (
          <div>
            <p className="text-xs font-medium tracking-wide text-secondary-text">最近異動</p>
            <ul className="mt-2 space-y-1.5">
              {recentLedger.map((e) => (
                <li key={e.id} className="flex items-baseline justify-between gap-2 text-sm">
                  <span className="min-w-0 truncate text-[13px] text-text">
                    {STORED_VALUE_LEDGER_TYPE_LABEL[e.type]}
                    {e.reason ? ` · ${e.reason}` : ""}
                    <span className="ml-2 text-xs text-secondary-text">
                      {formatYmd(new Date(e.createdAt))} {formatHm(new Date(e.createdAt))}
                    </span>
                  </span>
                  <span
                    className={cn(
                      "shrink-0 text-[13px] tabular-nums",
                      e.amountDelta >= 0 ? "text-text" : "text-secondary-text",
                    )}
                  >
                    {e.amountDelta >= 0 ? "+" : ""}
                    {formatTwd(e.amountDelta)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {commerceRemoteRead ? (
          <p className="text-sm text-secondary-text">儲值尚未開放</p>
        ) : (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs text-secondary-text">
            金額
            <input
              className="mt-1 min-h-11 w-28 rounded-2xl border border-border bg-surface px-3 text-sm tabular-nums"
              value={topUp}
              onChange={(e) => setTopUp(e.target.value)}
              inputMode="numeric"
              placeholder="金額"
            />
          </label>
          <Button className="min-h-11" onClick={startTopUp}>
            ＋ 新增儲值
          </Button>
        </div>
        )}

        {canAdjust ? (
          <details className="rounded-2xl border border-dashed border-border px-3">
            <summary className="flex min-h-11 cursor-pointer list-none items-center text-xs text-secondary-text [&::-webkit-details-marker]:hidden">
              調整餘額（管理）
            </summary>
            <div className="flex flex-wrap gap-2 pb-3">
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
                variant="ghost"
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
                確認調整
              </Button>
            </div>
          </details>
        ) : null}
      </Card>

      <Card padding="md">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[15px] font-semibold text-text">最近交易</h3>
          {onOpenTransactions ? (
            <button
              type="button"
              onClick={onOpenTransactions}
              className="text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              查看全部
            </button>
          ) : (
            <Link
              href={`/staff/customers/${customerId}?tab=transactions`}
              className="text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              查看全部
            </Link>
          )}
        </div>
        {recentTx.length === 0 ? (
          <p className="mt-3 text-sm text-secondary-text">尚無交易</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {recentTx.map((tx) => (
              <li key={tx.id} className="flex items-baseline justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-[14px] text-text">{tx.itemSummary}</p>
                  <p className="text-xs text-secondary-text">{tx.dateLabel}</p>
                </div>
                <p className="shrink-0 text-[14px] tabular-nums text-text">
                  {formatTwd(tx.totalMinor)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
