"use client";

import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { CHECKOUT_PANEL_WIDTH_PX } from "@/lib/commerce/checkout-workspace-derived";
import type { CommerceCheckoutCandidate } from "@/lib/commerce/commerce-remote-identity";
import {
  isRawCustomerId,
  isRawLocationId,
  isRawServiceId,
  isRawStaffId,
} from "@/lib/treatments/treatment-display";
import { formatHm } from "@/lib/appointments/domain";

function visibleLabel(value: string, fallback: string, isRaw: (value: string) => boolean) {
  const trimmed = value.trim();
  if (!trimmed || isRaw(trimmed)) return fallback;
  return trimmed;
}

export function CommerceIdentityPanel({
  candidate,
  locationName,
  readiness = "write_off",
  message,
  onClose,
}: {
  candidate: CommerceCheckoutCandidate;
  locationName?: string;
  readiness?: "write_off" | "loading" | "ready" | "error";
  message?: string;
  onClose: () => void;
}) {
  const customerName = visibleLabel(candidate.customerName, "客戶", isRawCustomerId);
  const serviceName = visibleLabel(candidate.serviceName, "療程", isRawServiceId);
  const staffName = visibleLabel(candidate.staffName, "—", isRawStaffId);
  const locationLabel = visibleLabel(locationName ?? "", "—", isRawLocationId);
  const time = candidate.startAt ? formatHm(new Date(candidate.startAt)) : "—";

  return (
    <aside
      data-commerce-identity-panel
      data-appointment-id={candidate.identity.appointmentId}
      data-treatment-id={candidate.identity.treatmentId}
      data-customer-id={candidate.identity.customerId}
      data-service-id={candidate.identity.serviceId}
      className="flex h-full min-h-[28rem] w-full flex-col overflow-hidden rounded-2xl border border-border bg-surface"
      style={{ maxWidth: CHECKOUT_PANEL_WIDTH_PX }}
    >
      <div className="flex items-start justify-between gap-3 px-5 py-4">
        <div className="min-w-0">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">待結帳</p>
          <h2 className="mt-1 truncate text-[18px] font-semibold text-text">{customerName}</h2>
          {candidate.customerPhone ? (
            <p className="mt-1 text-[13px] text-secondary-text">{candidate.customerPhone}</p>
          ) : null}
        </div>
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
          aria-label="關閉待結帳資料"
          onClick={onClose}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <dl className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pb-5 text-[14px]">
        <div className="flex justify-between gap-4">
          <dt className="text-secondary-text">服務</dt>
          <dd className="min-w-0 text-right font-medium text-text">{serviceName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-secondary-text">美容師</dt>
          <dd className="min-w-0 text-right font-medium text-text">{staffName}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-secondary-text">分店</dt>
          <dd className="min-w-0 text-right font-medium text-text">{locationLabel}</dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-secondary-text">時間</dt>
          <dd className="tabular-nums text-right font-medium text-text">
            {time}
            {candidate.durationMinutes ? ` · ${candidate.durationMinutes} 分鐘` : ""}
          </dd>
        </div>
        <div className="flex justify-between gap-4">
          <dt className="text-secondary-text">療程狀態</dt>
          <dd className="text-right font-medium text-text">已完成</dd>
        </div>
        <p className="rounded-2xl bg-[#FAF7F5] px-3.5 py-3 text-[13px] leading-relaxed text-secondary-text">
          {readiness === "loading"
            ? "正在準備結帳資料…"
            : readiness === "error"
              ? message || "目前無法開啟結帳，請稍後再試"
              : "此筆已完成療程已可結帳。遠端收款尚未開放。"}
        </p>
      </dl>

      <div className="border-t border-border px-5 py-4">
        <Button variant="outline" fullWidth disabled>
          {readiness === "loading" ? "準備中" : "正式結帳尚未開放"}
        </Button>
      </div>
    </aside>
  );
}
