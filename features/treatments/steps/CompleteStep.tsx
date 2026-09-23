"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import { getBodyAreaLabel } from "@/data/treatment-options";
import type { Appointment, Customer } from "@/types";
import type { TreatmentDraft, TreatmentPhoto } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";

interface CompleteStepProps {
  customer: Customer;
  appointment: Appointment;
  draft: TreatmentDraft;
  photos: TreatmentPhoto[];
  template: TreatmentTemplate;
  completed: boolean;
  validationError: string;
  onBack: () => void;
  onComplete: () => void;
}

function formatDateInput(value: string): string {
  if (!value) return "未設定";
  const [y, m, d] = value.split("-");
  if (!y || !m || !d) return value;
  return `${y}/${m}/${d}`;
}

function SummaryCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card padding="md" className="h-full">
      <h3 className="text-sm font-medium text-secondary-text">{title}</h3>
      <div className="mt-2 text-[15px] font-medium leading-relaxed text-text">{children}</div>
    </Card>
  );
}

export function CompleteStep({
  customer,
  appointment,
  draft,
  photos,
  template,
  completed,
  validationError,
  onBack,
  onComplete,
}: CompleteStepProps) {
  const { organization } = useOrganization();
  const beforeCount =
    photos.filter((p) => p.type === "BEFORE").length ||
    draft.photos.filter((p) => p.type === "BEFORE").length;
  const afterCount =
    photos.filter((p) => p.type === "AFTER").length ||
    draft.photos.filter((p) => p.type === "AFTER").length;

  const operationLabels = draft.operations.map(
    (id) =>
      template.operationGroups.flatMap((g) => g.items).find((item) => item.id === id)
        ?.label ?? id,
  );
  const productLabels = draft.products.map(
    (id) => template.products.find((item) => item.id === id)?.label ?? id,
  );
  const markerLabels = draft.bodyMarkers.map(
    (marker) => getBodyAreaLabel(marker.area, template.bodyAreas),
  );

  const showBody =
    !draft.skippedSteps.includes("bodyMap") &&
    (markerLabels.length > 0 || draft.bodyMapNote.trim().length > 0);
  const showPhotos =
    !draft.skippedSteps.includes("photos") && (beforeCount > 0 || afterCount > 0);
  const showFollowUp =
    !draft.skippedSteps.includes("followUp") &&
    (draft.followUp.tags.length > 0 ||
      draft.followUp.suggestedDate.length > 0 ||
      draft.followUp.note.trim().length > 0);

  const summaryGrid = (
    <div className="mt-5 grid gap-3 sm:grid-cols-2">
      <SummaryCard title="今日狀況">
        {draft.assessment.concerns.length > 0
          ? draft.assessment.concerns.join("、")
          : "未填寫"}
      </SummaryCard>
      {showBody ? (
        <SummaryCard title="部位紀錄">
          {markerLabels.length > 0 ? markerLabels.join("、") : "有備註"}
          {markerLabels.length > 0 ? (
            <span className="mt-1 block text-sm font-normal text-secondary-text">
              {draft.bodyMarkers.length} 個標記
            </span>
          ) : null}
        </SummaryCard>
      ) : null}
      <SummaryCard title="操作項目">
        {operationLabels.length} 項
        {operationLabels.length > 0 ? (
          <span className="mt-1 block text-sm font-normal text-secondary-text">
            {operationLabels.slice(0, 4).join("、")}
            {operationLabels.length > 4 ? "…" : ""}
          </span>
        ) : null}
      </SummaryCard>
      <SummaryCard title="使用產品">
        {productLabels.length} 項
        {productLabels.length > 0 ? (
          <span className="mt-1 block text-sm font-normal text-secondary-text">
            {productLabels.join("、")}
          </span>
        ) : null}
      </SummaryCard>
      {showPhotos ? (
        <SummaryCard title="照片">
          Before {beforeCount}
          <span className="mx-2 text-border">·</span>
          After {afterCount}
        </SummaryCard>
      ) : null}
      <SummaryCard title="療程後感受">
        {draft.clientFeeling || "未填寫"}
        {draft.clientFeeling === "不舒服" && draft.discomfortNote ? (
          <span className="mt-1 block text-sm font-normal text-secondary-text">
            {draft.discomfortNote}
          </span>
        ) : null}
      </SummaryCard>
      {draft.professionalNote.trim() ? (
        <SummaryCard title="專業紀錄">
          <span className="line-clamp-3 font-normal">{draft.professionalNote}</span>
        </SummaryCard>
      ) : null}
      {showFollowUp ? (
        <SummaryCard title="下次追蹤">
          {draft.followUp.tags.length > 0 ? draft.followUp.tags.join("、") : "有備註"}
        </SummaryCard>
      ) : null}
      {showFollowUp && draft.followUp.suggestedDate ? (
        <SummaryCard title="建議日期">
          {formatDateInput(draft.followUp.suggestedDate)}
        </SummaryCard>
      ) : null}
    </div>
  );

  if (completed) {
    return (
      <div className="mx-auto w-full max-w-[1100px]">
        <Card padding="lg" className="text-center sm:text-left">
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-start">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full bg-[#E8F3EC] text-success">
              <Check className="h-7 w-7" strokeWidth={2.5} aria-hidden />
            </div>
            <div className="min-w-0 flex-1 text-center sm:text-left">
              <p className="text-[11px] tracking-[0.18em] text-secondary-text">
                {PLATFORM_NAME}
              </p>
              <p className="mt-1 font-display text-sm tracking-[0.18em] text-primary">
                {organization.name}
              </p>
              <div className="mt-2 flex flex-wrap items-center justify-center gap-2 sm:justify-start">
                <h1 className="text-2xl font-semibold text-text sm:text-[28px]">
                  本次服務已完成
                </h1>
                {draft.mode === "QUICK" ? (
                  <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
                    快速紀錄
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-[15px] leading-relaxed text-secondary-text">
                辛苦了，這次的照顧已經完整記錄 ♡
              </p>
              <p className="mt-4 text-[15px] text-text">
                <span className="font-semibold">{customer.name}</span>
                <span className="mx-2 text-border">·</span>
                {appointment.serviceName}
                <span className="mx-2 text-border">·</span>
                {appointment.durationMinutes}分鐘
                <span className="mx-2 text-border">·</span>
                {appointment.staffName}
              </p>
            </div>
          </div>

          {summaryGrid}

          <div className="mt-8 flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
            <Link href="/staff/appointments" className="block sm:min-w-[12rem]">
              <Button fullWidth size="lg">
                預約下一次
              </Button>
            </Link>
            <Link href={`/staff/checkout?appointment=${appointment.id}&treatment=${draft.id}`} className="block sm:min-w-[12rem]">
              <Button fullWidth size="lg">
                前往結帳
              </Button>
            </Link>
            <Link href="/staff/today" className="block sm:min-w-[12rem]">
              <Button variant="outline" fullWidth size="lg">
                返回今日工作台
              </Button>
            </Link>
            <Link href={`/staff/customers/${customer.id}`} className="block sm:min-w-[12rem]">
              <Button variant="ghost" fullWidth size="lg">
                查看客戶美容履歷
              </Button>
            </Link>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-text">本次服務完成確認</h1>
          {draft.mode === "QUICK" ? (
            <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
              快速紀錄
            </span>
          ) : null}
        </div>
        <p className="mt-2 text-[15px] text-secondary-text">確認摘要後即可儲存完成</p>
      </header>

      <Card padding="lg">
        <h2 className="text-xl font-semibold text-text">{customer.name}</h2>
        <p className="mt-2 text-[15px] text-secondary-text">
          {appointment.serviceName}
          <span className="mx-1.5 text-border">·</span>
          {appointment.durationMinutes}分鐘
        </p>
        <p className="mt-1 text-sm text-secondary-text">美容師：{appointment.staffName}</p>
        <p className="mt-1 text-sm text-secondary-text">日期：今天</p>
        <p className="mt-1 text-sm text-secondary-text">模板：{template.name}</p>
      </Card>

      {summaryGrid}

      {validationError ? (
        <p
          role="alert"
          className="mt-4 rounded-2xl bg-[#F7E8E8] px-4 py-3 text-sm text-[#B15B5B]"
        >
          {validationError}
        </p>
      ) : null}

      <StepFooter onBack={onBack} onNext={onComplete} nextLabel="儲存並完成服務" />
    </div>
  );
}
