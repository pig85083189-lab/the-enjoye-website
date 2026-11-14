"use client";

import { useState } from "react";
import type { Appointment, Customer } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import { QuickRecordDialog } from "@/features/treatments/QuickRecordDialog";
import { MEMBERSHIP_LABEL } from "@/lib/utils";

interface CustomerSummaryStepProps {
  customer: Customer;
  appointment: Appointment;
  templateName: string;
  onNext: () => void;
  onQuickRecord: () => void;
}

const membershipTone = {
  vip: "vip" as const,
  regular: "neutral" as const,
  new: "new" as const,
};

export function CustomerSummaryStep({
  customer,
  appointment,
  templateName,
  onNext,
  onQuickRecord,
}: CustomerSummaryStepProps) {
  const [quickOpen, setQuickOpen] = useState(false);
  const isReturning = customer.membership !== "new" && customer.totalVisits > 1;

  return (
    <div>
      <Card padding="lg">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-text">{customer.name}</h1>
          <Badge tone={membershipTone[customer.membership]}>
            {MEMBERSHIP_LABEL[customer.membership]}
          </Badge>
          <span className="text-sm text-secondary-text">{customer.age}歲</span>
        </div>

        <div className="mt-5 rounded-2xl bg-primary-light/50 px-4 py-3">
          <p className="text-sm text-secondary-text">本次服務項目</p>
          <p className="mt-1 text-[15px] font-medium text-text">
            {appointment.serviceName}
            <span className="mx-1.5 text-border">·</span>
            {appointment.durationMinutes}分鐘
          </p>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-secondary-text">金額</dt>
            <dd className="mt-1 text-[15px] font-medium text-text">依本次結帳金額為準</dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">美容師</dt>
            <dd className="mt-1 text-[15px] font-medium text-text">{appointment.staffName}</dd>
          </div>
        </dl>
      </Card>

      {isReturning ? (
        <Card padding="md" className="mt-4 border-primary/25 bg-primary-light/25">
          <h2 className="text-base font-semibold text-text">快速紀錄</h2>
          <p className="mt-2 text-[15px] leading-relaxed text-secondary-text">
            可沿用既有療程資料加快填寫，並於專業紀錄確認本次內容。
          </p>
          <Button className="mt-4" onClick={() => setQuickOpen(true)}>
            開始快速紀錄
          </Button>
        </Card>
      ) : null}

      <StepFooter hideBack onNext={onNext} nextLabel="開始今日評估" />

      <QuickRecordDialog
        open={quickOpen}
        templateName={templateName}
        onCancel={() => setQuickOpen(false)}
        onConfirm={() => {
          setQuickOpen(false);
          onQuickRecord();
        }}
      />
    </div>
  );
}
