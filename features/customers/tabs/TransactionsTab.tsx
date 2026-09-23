"use client";

import Link from "next/link";
import { useSyncExternalStore } from "react";
import { Card } from "@/components/ui/Card";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { PAYMENT_METHOD_LABEL, TRANSACTION_STATUS_LABEL } from "@/lib/commerce/domain";
import { formatTwd } from "@/lib/commerce/money";
import { listTransactions } from "@/lib/commerce/transaction-store";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

interface TransactionsTabProps {
  customerId: string;
}

export function TransactionsTab({ customerId }: TransactionsTabProps) {
  const { organization } = useOrganization();
  const revision = useSyncExternalStore(subscribeCommerce, getCommerceRevision, () => "");
  void revision;
  const rows = listTransactions(organization.id, { customerId });

  if (rows.length === 0) {
    return (
      <Card padding="lg" className="text-sm text-secondary-text">
        尚無交易紀錄。
      </Card>
    );
  }

  return (
    <ul className="space-y-2">
      {rows.map((tx) => {
        const methods = tx.payments.map((p) => PAYMENT_METHOD_LABEL[p.method]).join("、");
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
              <p className="mt-1 text-sm text-secondary-text">
                {methods || "無付款列"} ·{" "}
                <span className="font-medium text-text">
                  {TRANSACTION_STATUS_LABEL[tx.status]}
                </span>
              </p>
              <p className="text-xs text-secondary-text">
                {formatYmd(new Date(tx.completedAt))} {formatHm(new Date(tx.completedAt))}
              </p>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
