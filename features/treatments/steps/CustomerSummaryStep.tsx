"use client";

import { useState } from "react";
import type { Appointment, Customer } from "@/types";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import { QuickRecordDialog } from "@/features/treatments/QuickRecordDialog";
import { MEMBERSHIP_LABEL, cn } from "@/lib/utils";

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
          <p className="text-sm text-secondary-text">本次</p>
          <p className="mt-1 text-[15px] font-medium text-text">
            {appointment.serviceName}
            <span className="mx-1.5 text-border">·</span>
            {appointment.durationMinutes}分鐘
          </p>
        </div>

        <dl className="mt-5 grid gap-3 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-secondary-text">上次服務</dt>
            <dd className="mt-1 text-[15px] font-medium text-text">{customer.lastVisit}</dd>
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
            如果今天狀況與上次差不多，可以沿用上次紀錄與標準流程，快速完成本次服務紀錄。
          </p>
          <Button className="mt-4" onClick={() => setQuickOpen(true)}>
            開始快速紀錄
          </Button>
        </Card>
      ) : null}

      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Card padding="md">
          <h2 className="text-base font-semibold text-text">上次服務重點</h2>
          <ul className="mt-3 space-y-1.5">
            {customer.lastServiceNotes.map((note) => (
              <li key={note} className="text-[15px] text-text">
                {note}
              </li>
            ))}
          </ul>
        </Card>
        <Card padding="md">
          <h2 className="text-base font-semibold text-text">本次追蹤</h2>
          <ul className="mt-3 space-y-1.5">
            {customer.trackingFocus.map((item) => (
              <li key={item} className="text-[15px] text-text">
                {item}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card padding="md" className="mt-4">
        <h2 className="text-base font-semibold text-text">健康提醒</h2>
        <ul className="mt-3 divide-y divide-border">
          {customer.alerts.map((alert) => (
            <li key={alert.id} className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-sm text-secondary-text">{alert.label}</span>
              <span
                className={cn(
                  "text-sm font-medium",
                  alert.tone === "warning" && "text-warning",
                  alert.tone === "success" && "text-success",
                  (!alert.tone || alert.tone === "neutral") && "text-text",
                )}
              >
                {alert.tone === "warning" ? `⚠ ${alert.value}` : alert.value}
              </span>
            </li>
          ))}
        </ul>
      </Card>

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
