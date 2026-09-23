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
import {
  PAYMENT_METHOD_LABEL,
  TRANSACTION_STATUS_LABEL,
} from "@/lib/commerce/domain";
import { formatTwd } from "@/lib/commerce/money";
import {
  getTransaction,
  listTransactions,
} from "@/lib/commerce/transaction-store";
import {
  canActorVoidTransaction,
  voidTransaction,
  type VoidTransactionResult,
} from "@/lib/commerce/void-transaction";
import { getCustomerById } from "@/data/mock-customers";
import { listLocations } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import { CHECKOUT_ITEM_TYPE_LABEL } from "@/lib/products/domain";
import { Suspense } from "react";

function statusLabel(status: "COMPLETED" | "VOIDED"): string {
  return TRANSACTION_STATUS_LABEL[status];
}

function TransactionsInner() {
  const searchParams = useSearchParams();
  const detailId = searchParams.get("id");
  const { organization, currentLocation, locations, membership } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;

  const [filter, setFilter] = useState<"today" | "all">("today");
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidReason, setVoidReason] = useState("");
  const [voidError, setVoidError] = useState("");
  const [voidBusy, setVoidBusy] = useState(false);
  const [lastVoidResult, setLastVoidResult] = useState<VoidTransactionResult | null>(
    null,
  );
  const orgLocations = listLocations(organization.id);
  const staffId = membership?.userId ?? "";
  const canVoid =
    Boolean(staffId) && canActorVoidTransaction(organization.id, staffId);

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
    const externalActions =
      lastVoidResult?.transaction.id === tx.id
        ? lastVoidResult.externalTenderActions
        : tx.payments
            .filter((p) =>
              p.method === "CASH" ||
              p.method === "CARD" ||
              p.method === "TRANSFER" ||
              p.method === "OTHER",
            )
            .map((p) => ({
              method: p.method,
              amount: p.amount,
              status: "MANUAL_EXTERNAL_REQUIRED" as const,
            }));

    const confirmVoid = () => {
      setVoidError("");
      setVoidBusy(true);
      try {
        const result = voidTransaction(organization.id, tx.id, {
          actorStaffId: staffId,
          reason: voidReason,
        });
        setLastVoidResult(result);
        setVoidOpen(false);
        setVoidReason("");
      } catch (err) {
        setVoidError(err instanceof Error ? err.message : "作廢失敗");
      } finally {
        setVoidBusy(false);
      }
    };

    return (
      <div className="space-y-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-text">{tx.transactionNumber}</h1>
            <p className="mt-1 text-sm text-secondary-text">
              <span className="font-medium text-text">{statusLabel(tx.status)}</span>
              {" · "}
              {locationName}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {tx.status === "COMPLETED" && canVoid ? (
              <Button
                variant="outline"
                className="min-h-11"
                onClick={() => {
                  setVoidOpen(true);
                  setVoidError("");
                }}
              >
                作廢交易
              </Button>
            ) : null}
            <Link href="/staff/transactions">
              <Button variant="outline" className="min-h-11">
                返回列表
              </Button>
            </Link>
          </div>
        </header>

        {tx.status === "VOIDED" ? (
          <Card padding="lg" className="space-y-2 border-danger/30 bg-[#F7E8E8]/40 text-sm">
            <p className="text-base font-semibold text-danger">已作廢</p>
            <p>
              作廢時間：
              {tx.voidedAt
                ? `${formatYmd(new Date(tx.voidedAt))} ${formatHm(new Date(tx.voidedAt))}`
                : "—"}
            </p>
            <p>操作人員：{tx.voidedBy ?? "—"}</p>
            <p>原因：{tx.voidReason ?? "—"}</p>
            <p className="text-secondary-text">原交易紀錄仍完整保留，總額不會改寫。</p>
            {lastVoidResult?.transaction.id === tx.id &&
            (lastVoidResult.packageReversals.length > 0 ||
              lastVoidResult.storedValueReversals.length > 0) ? (
              <div className="mt-2 space-y-1 border-t border-border pt-2">
                <p className="font-medium text-text">帳務回沖摘要</p>
                {lastVoidResult.packageReversals.map((e) => (
                  <p key={e.id} className="text-secondary-text">
                    套票作廢回沖 {e.sessionDelta > 0 ? "+" : ""}
                    {e.sessionDelta} 堂
                  </p>
                ))}
                {lastVoidResult.storedValueReversals.map((e) => (
                  <p key={e.id} className="text-secondary-text">
                    儲值金作廢回沖 {e.amountDelta >= 0 ? "+" : ""}
                    {formatTwd(e.amountDelta)}
                  </p>
                ))}
              </div>
            ) : null}
            {externalActions.length > 0 ? (
              <div className="mt-2 space-y-1 border-t border-border pt-2">
                <p className="font-medium text-text">外部款項需人工處理</p>
                {externalActions.map((a, i) => (
                  <p key={`${a.method}-${i}`} className="text-secondary-text">
                    {PAYMENT_METHOD_LABEL[a.method]} {formatTwd(a.amount)}
                    ：系統未完成實體退款，請由店家實際處理。
                  </p>
                ))}
              </div>
            ) : null}
          </Card>
        ) : null}

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
            <div key={item.id} className="flex justify-between gap-3 text-sm">
              <span>
                <span className="text-secondary-text">
                  {CHECKOUT_ITEM_TYPE_LABEL[item.type] ?? item.type}
                </span>
                <span className="mx-1.5 text-border">·</span>
                {item.nameSnapshot}
                {item.quantity > 1 ? ` × ${item.quantity}` : null}
              </span>
              <span className="shrink-0 tabular-nums">{formatTwd(item.lineTotal)}</span>
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

        {voidOpen ? (
          <Card padding="lg" className="space-y-3 border-primary/30">
            <h2 className="text-lg font-semibold text-text">確認作廢交易</h2>
            <p className="text-sm text-secondary-text">
              {tx.transactionNumber} · {customer?.name ?? tx.customerId} ·{" "}
              {formatTwd(tx.total)}
            </p>
            <ul className="text-sm text-secondary-text">
              {tx.payments.map((p) => (
                <li key={p.id}>
                  {PAYMENT_METHOD_LABEL[p.method]} {formatTwd(p.amount)}
                </li>
              ))}
            </ul>
            <p className="text-sm font-medium text-text">
              作廢不會刪除原交易紀錄。
            </p>
            <label className="block text-sm">
              <span className="text-secondary-text">作廢原因</span>
              <textarea
                className="mt-1 min-h-24 w-full rounded-2xl border border-border bg-surface px-3 py-2 text-text"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="例如：結帳付款方式選錯、重複結帳、操作錯誤"
              />
            </label>
            {voidError ? (
              <p role="alert" className="text-sm text-danger">
                {voidError}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                className="min-h-11"
                disabled={voidBusy}
                onClick={confirmVoid}
              >
                {voidBusy ? "處理中…" : "確認作廢"}
              </Button>
              <Button
                variant="outline"
                className="min-h-11"
                disabled={voidBusy}
                onClick={() => setVoidOpen(false)}
              >
                取消
              </Button>
            </div>
          </Card>
        ) : null}
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
                    {customer?.name ?? tx.customerId} · {methods || "無付款列"} ·{" "}
                    <span className="font-medium text-text">{statusLabel(tx.status)}</span>
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
