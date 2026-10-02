"use client";

import { useState } from "react";
import Link from "next/link";
import { MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CustomerTagChips } from "@/components/customers/CustomerTagChips";
import type { Customer360Snapshot } from "@/features/customers/use-customer-360";
import {
  customerConsultationNewHref,
  customerEditHref,
} from "@/lib/customers/customer-360";
import type { Customer } from "@/types";

interface CustomerSummaryPanelProps {
  customer: Customer;
  snapshot: Customer360Snapshot;
  onStartTreatment: () => void;
  onAddFollowUp: () => void;
  onOpenNotes: () => void;
  readOnly?: boolean;
}

export function CustomerSummaryPanel({
  customer,
  snapshot,
  onStartTreatment,
  onAddFollowUp,
  onOpenNotes,
  readOnly = false,
}: CustomerSummaryPanelProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const next = snapshot.nextAppointment;

  return (
    <Card
      padding="md"
      className="space-y-7 min-[1200px]:w-[320px] min-[1200px]:min-w-[300px] min-[1200px]:max-w-[330px]"
    >
      <div>
        <h2 className="text-[15px] font-semibold text-text">客戶摘要</h2>
      </div>

      <dl className="space-y-3 text-[14px]">
        <SummaryRow label="最近到店" value={snapshot.lastVisitLabel ?? "—"} />
        <SummaryRow
          label="累積到店"
          value={snapshot.visitCount > 0 ? `${snapshot.visitCount} 次` : "尚未到店"}
        />
        <SummaryRow label="主要療程" value={snapshot.primaryServiceName ?? "—"} />
        <SummaryRow label="負責美容師" value={customer.primaryStaffName ?? "—"} />
        <div>
          <div className="flex justify-between gap-3">
            <dt className="text-xs text-secondary-text">下次預約</dt>
            <dd className="text-right text-[14px] font-medium text-text">
              {next ? `${next.dateLabel} ${next.timeLabel}` : "尚未安排"}
            </dd>
          </div>
          {!next ? (
            <Link
              href={snapshot.createHref}
              className="mt-1 inline-flex min-h-9 items-center text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              ＋ 安排預約
            </Link>
          ) : null}
        </div>
      </dl>

      <div>
        <p className="mb-2.5 text-xs font-medium tracking-wide text-secondary-text">客戶標籤</p>
        {customer.tags.length > 0 ? (
          <CustomerTagChips tags={customer.tags} />
        ) : (
          <p className="text-xs text-secondary-text">尚無標籤</p>
        )}
      </div>

      <div>
        <p className="mb-2.5 text-xs font-medium tracking-wide text-secondary-text">需要注意</p>
        {snapshot.attention.length > 0 ? (
          <ul className="space-y-1.5">
            {snapshot.attention.slice(0, 4).map((note) => (
              <li key={note} className="flex gap-2 text-[13px] leading-snug text-text">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-secondary-text">近期無特別注意事項</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-xs font-medium tracking-wide text-secondary-text">快速操作</p>
        <Button
          fullWidth
          className="min-h-11"
          disabled={readOnly}
          onClick={onStartTreatment}
        >
          開始療程紀錄
        </Button>
        {readOnly ? (
          <Button fullWidth variant="secondary" className="min-h-11" disabled>
            新增預約
          </Button>
        ) : (
          <Link href={snapshot.createHref} className="block">
            <Button fullWidth variant="secondary" className="min-h-11">
              新增預約
            </Button>
          </Link>
        )}
        <Button
          fullWidth
          variant="outline"
          className="min-h-11"
          disabled={readOnly}
          onClick={onAddFollowUp}
        >
          新增追蹤
        </Button>
        <div className="relative">
          <Button
            fullWidth
            variant="ghost"
            className="min-h-11"
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen((value) => !value)}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden />
            更多操作
          </Button>
          {moreOpen ? (
            <div
              role="menu"
              className="absolute inset-x-0 z-20 mt-1 rounded-2xl border border-border bg-surface p-1 shadow-[0_8px_24px_rgba(48,43,43,0.08)]"
            >
              {readOnly ? null : (
                <Link
                  href={customerEditHref(customer.id)}
                  role="menuitem"
                  className="flex min-h-11 items-center rounded-xl px-3 text-sm text-text hover:bg-[#FBF4F3]"
                  onClick={() => setMoreOpen(false)}
                >
                  編輯資料
                </Link>
              )}
              {readOnly ? null : (
                <Link
                  href={customerConsultationNewHref(customer.id)}
                  role="menuitem"
                  className="flex min-h-11 items-center rounded-xl px-3 text-sm text-text hover:bg-[#FBF4F3]"
                  onClick={() => setMoreOpen(false)}
                >
                  新增諮詢更新
                </Link>
              )}
              <button
                type="button"
                role="menuitem"
                className="flex min-h-11 w-full items-center rounded-xl px-3 text-left text-sm text-text hover:bg-[#FBF4F3]"
                onClick={() => {
                  setMoreOpen(false);
                  onOpenNotes();
                }}
              >
                內部備註
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </Card>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-xs text-secondary-text">{label}</dt>
      <dd className="text-right text-[14px] font-medium text-text">{value}</dd>
    </div>
  );
}
