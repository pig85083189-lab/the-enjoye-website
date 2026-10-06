"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/Card";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { PAYMENT_METHOD_LABEL, TRANSACTION_STATUS_LABEL } from "@/lib/commerce/domain";
import type { Transaction } from "@/lib/commerce/domain";
import { formatTwd } from "@/lib/commerce/money";
import { listTransactions } from "@/lib/commerce/transaction-store";
import { utcIsoToTaipeiLocal } from "@/lib/persistence/appointment-time";
import { resolveCustomer360Transactions } from "@/lib/customers/customer-360";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

function formatCompletedAtTaipei(iso: string): string {
  const { dateYmd, hm } = utcIsoToTaipeiLocal(iso);
  const [year, month, day] = dateYmd.split("-");
  return `${year}/${month}/${day} ${hm}`;
}

interface TransactionsTabProps {
  customerId: string;
  commerceRemoteRead?: boolean;
  remoteTransactions?: Transaction[] | null;
}

export function TransactionsTab({
  customerId,
  commerceRemoteRead = false,
  remoteTransactions = null,
}: TransactionsTabProps) {
  const { organization } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;
  const rows = resolveCustomer360Transactions(
    commerceRemoteRead ? (remoteTransactions ?? []) : null,
    listTransactions(organization.id, { customerId }),
  );

  if (rows.length === 0) {
    return (
      <Card
        padding="lg"
        className="text-center"
        data-customer-transactions-source={commerceRemoteRead ? "remote-pilot" : "local"}
        data-customer-transactions-state="empty"
      >
        <p className="text-[15px] font-medium text-text">尚無交易</p>
        <Link
          href="/staff/checkout"
          className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary"
        >
          前往結帳
        </Link>
      </Card>
    );
  }

  return (
    <ul
      className="space-y-2"
      data-customer-transactions-source={commerceRemoteRead ? "remote-pilot" : "local"}
      data-customer-transactions-state="data"
    >
      {rows.map((tx) => {
        const methods = tx.payments
          .map((p) => PAYMENT_METHOD_LABEL[p.method])
          .filter(Boolean)
          .join("、");
        const itemSummary = tx.items[0]?.nameSnapshot;
        return (
          <li key={tx.id}>
            <Link
              href={`/staff/transactions?id=${tx.id}`}
              className="block min-h-11 rounded-2xl border border-border bg-surface px-4 py-3"
            >
              <div className="flex justify-between gap-2">
                <p className="font-medium text-text">{tx.transactionNumber}</p>
                <p className="tabular-nums font-medium">{formatTwd(tx.total)}</p>
              </div>
              {itemSummary ? (
                <p className="mt-1 truncate text-sm text-text">{itemSummary}</p>
              ) : null}
              <p className="mt-1 text-sm text-secondary-text">
                {methods || "無付款列"} ·{" "}
                <span className="font-medium text-text">
                  {TRANSACTION_STATUS_LABEL[tx.status]}
                </span>
              </p>
              <p className="text-xs text-secondary-text">
                {formatCompletedAtTaipei(tx.completedAt)}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
