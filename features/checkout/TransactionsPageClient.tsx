"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { PAYMENT_METHOD_LABEL } from "@/lib/commerce/domain";
import { formatTwd } from "@/lib/commerce/money";
import {
  getTransaction,
  listTransactions,
} from "@/lib/commerce/transaction-store";
import { getCustomerById } from "@/data/mock-customers";
import { listLocations } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import { Suspense } from "react";

function TransactionsInner() {
  const searchParams = useSearchParams();
  const detailId = searchParams.get("id");
  const { organization, currentLocation, locations } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;

  const [filter, setFilter] = useState<"today" | "all">("today");
  const orgLocations = listLocations(organization.id);

  const transactions = useMemo(() => {
    const day = new Date();
    if (filter === "today") {
      return listTransactions(organization.id, {
        from: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0),
        to: new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999),
      });
    }
    return listTransactions(organization.id);
  }, [organization.id, filter]);

  if (detailId) {
    const tx = getTransaction(organization.id, detailId);
    if (!tx) {
      return (
        <Card padding="lg" className="text-sm text-secondary-text">
          找不到交易，或屬於其他組織。
          <Link href="/staff/transactions" className="mt-2 block text-primary">
            返回列表
          </Link>
        </Card>
      );
    }
    const customer = getCustomerById(tx.customerId, organization.id);
    const locationName =
      orgLocations.find((l) => l.id === tx.locationId)?.name ??
      locations.find((l) => l.id === tx.locationId)?.name ??
      tx.locationId;

    return (
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text">{tx.transactionNumber}</h1>
            <p className="mt-1 text-sm text-secondary-text">
              {tx.status} · {locationName}
            </p>
          </div>
          <Link href="/staff/transactions">
            <Button variant="outline" className="min-h-11">
              返回列表
            </Button>
          </Link>
        </header>

        <Card padding="lg" className="space-y-2 text-sm">
          <p>
            客戶：{" "}
            <Link className="text-primary" href={`/staff/customers/${tx.customerId}`}>
              {customer?.name ?? tx.customerId}
            </Link>
          </p>
          {tx.appointmentId ? (
            <p>
              預約：{" "}
              <Link className="text-primary" href={`/staff/calendar`}>
                {tx.appointmentId}
              </Link>
            </p>
          ) : null}
          {tx.treatmentId ? <p>療程：{tx.treatmentId}</p> : null}
          <p>
            完成時間：{formatYmd(new Date(tx.completedAt))}{" "}
            {formatHm(new Date(tx.completedAt))}
          </p>
          <p>結帳人員：{tx.createdByStaffId}</p>
        </Card>

        <Card padding="lg" className="space-y-2">
          <h2 className="text-sm font-medium text-secondary-text">項目（不可變更）</h2>
          {tx.items.map((item) => (
            <div key={item.id} className="flex justify-between text-sm">
              <span>
                {item.nameSnapshot} × {item.quantity}
              </span>
              <span className="tabular-nums">{formatTwd(item.lineTotal)}</span>
            </div>
          ))}
        </Card>

        {tx.discounts.length > 0 ? (
          <Card padding="lg" className="space-y-2">
            <h2 className="text-sm font-medium text-secondary-text">折扣</h2>
            {tx.discounts.map((d) => (
              <div key={d.id} className="flex justify-between text-sm">
                <span>{d.label ?? d.type}</span>
                <span className="tabular-nums">−{formatTwd(d.amountApplied)}</span>
              </div>
            ))}
          </Card>
        ) : null}

        <Card padding="lg" className="space-y-2">
          <h2 className="text-sm font-medium text-secondary-text">付款</h2>
          {tx.payments.map((p) => (
            <div key={p.id} className="flex justify-between text-sm">
              <span>{PAYMENT_METHOD_LABEL[p.method]}</span>
              <span className="tabular-nums">{formatTwd(p.amount)}</span>
            </div>
          ))}
          <div className="flex justify-between border-t border-border pt-2 font-semibold">
            <span>合計</span>
            <span className="tabular-nums">{formatTwd(tx.total)}</span>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-text">交易紀錄</h1>
          <p className="mt-1 text-sm text-secondary-text">
            {currentLocation?.name ?? "全分店"} · {organization.name}
          </p>
        </div>
        <div className="flex gap-2">
          {(["today", "all"] as const).map((id) => (
            <button
              key={id}
              type="button"
              aria-pressed={filter === id}
              onClick={() => setFilter(id)}
              className={`min-h-11 rounded-2xl px-4 text-sm ${
                filter === id ? "bg-primary text-white" : "bg-surface text-text"
              }`}
            >
              {id === "today" ? "今天" : "全部"}
            </button>
          ))}
        </div>
      </header>

      {transactions.length === 0 ? (
        <Card padding="lg" className="text-sm text-secondary-text">
          尚無交易紀錄。
        </Card>
      ) : (
        <ul className="space-y-2">
          {transactions.map((tx) => {
            const customer = getCustomerById(tx.customerId, organization.id);
            const methods = tx.payments
              .map((p) => PAYMENT_METHOD_LABEL[p.method])
              .join("、");
            return (
              <li key={tx.id}>
                <Link
                  href={`/staff/transactions?id=${tx.id}`}
                  className="block min-h-11 rounded-2xl border border-border bg-surface px-4 py-3"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-text">{tx.transactionNumber}</p>
                    <p className="tabular-nums font-medium text-text">
                      {formatTwd(tx.total)}
                    </p>
                  </div>
                  <p className="mt-1 text-sm text-secondary-text">
                    {customer?.name ?? tx.customerId} · {methods} · {tx.status}
                  </p>
                  <p className="text-xs text-secondary-text">
                    {formatYmd(new Date(tx.completedAt))}{" "}
                    {formatHm(new Date(tx.completedAt))}
                  </p>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export function TransactionsPageClient() {
  return (
    <Suspense fallback={<p className="text-sm text-secondary-text">載入交易…</p>}>
      <TransactionsInner />
    </Suspense>
  );
}
