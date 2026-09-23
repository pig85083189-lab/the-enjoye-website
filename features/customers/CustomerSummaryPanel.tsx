"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { CustomerTagChips } from "@/components/customers/CustomerTagChips";
import type { Customer } from "@/types";

interface CustomerSummaryPanelProps {
  customer: Customer;
  onStartTreatment: () => void;
  onAddNote: () => void;
}

export function CustomerSummaryPanel({
  customer,
  onStartTreatment,
  onAddNote,
}: CustomerSummaryPanelProps) {
  const mainService = customer.lastServiceName || "—";

  return (
    <Card padding="lg" className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-text">客戶摘要</h2>
        <p className="mt-1 text-xs text-secondary-text">僅供內部服務紀錄使用</p>
      </div>

      <dl className="space-y-3 text-[15px]">
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">最近到店</dt>
          <dd className="font-medium text-text">{customer.lastVisit || "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">累積到店</dt>
          <dd className="font-medium text-text">{customer.totalVisits}次</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">主要療程</dt>
          <dd className="text-right font-medium text-text">{mainService}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">最近美容師</dt>
          <dd className="font-medium text-text">{customer.primaryStaffName ?? "—"}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">下次預約</dt>
          <dd className="text-right font-medium text-text">
            {customer.nextAppointmentLabel ?? "尚無"}
          </dd>
        </div>
      </dl>

      <div>
        <p className="mb-2 text-sm text-secondary-text">客戶標籤</p>
        <CustomerTagChips tags={customer.tags} />
      </div>

      <div className="space-y-2">
        <p className="text-sm text-secondary-text">快速操作</p>
        <Button fullWidth className="min-h-11" onClick={onStartTreatment}>
          開始療程
        </Button>
        <Link href="/staff/appointments" className="block">
          <Button fullWidth variant="secondary" className="min-h-11">
            新增預約
          </Button>
        </Link>
        <Button fullWidth variant="outline" className="min-h-11" onClick={onAddNote}>
          新增備註
        </Button>
      </div>
    </Card>
  );
}
