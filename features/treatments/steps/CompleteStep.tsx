"use client";

import { useMemo, useState, useSyncExternalStore, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import { useIsClient } from "@/lib/repositories/use-crm-store";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { buildCommerceCheckoutHref } from "@/lib/commerce/commerce-remote-identity";
import {
  applyPostTreatmentCheckoutIntent,
  loadEligiblePackagesForTreatment,
} from "@/lib/core-ops/post-treatment-checkout";
import {
  PACKAGE_ELIGIBILITY_ERROR_MESSAGE,
  POST_TREATMENT_REDEMPTION_SESSIONS,
  buildNextAppointmentHref,
  type PostTreatmentPackageCard,
} from "@/lib/core-ops/post-treatment-derived";
import { cn } from "@/lib/utils";
import { loadConsultationFields } from "@/lib/consultation-settings";

interface CompleteStepProps {
  customer: Customer;
  appointment: Appointment;
  draft: TreatmentDraft;
  photos: TreatmentPhoto[];
  template: TreatmentTemplate;
  completed: boolean;
  validationError: string;
  commerceRemoteRead?: boolean;
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

function PackageSelectCard({
  pkg,
  serviceName,
  selected,
  onSelect,
  onUse,
}: {
  pkg: PostTreatmentPackageCard;
  serviceName: string;
  selected: boolean;
  onSelect: () => void;
  onUse: () => void;
}) {
  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect();
    }
  }

  return (
    <div
      role="option"
      tabIndex={0}
      aria-selected={selected}
      aria-label={`${pkg.nameSnapshot}，剩餘 ${pkg.usableBalance} 堂`}
      data-package-card={pkg.customerPackageId}
      data-package-selected={selected ? "true" : "false"}
      onClick={onSelect}
      onKeyDown={handleKeyDown}
      className={cn(
        "min-w-0 cursor-pointer rounded-2xl border border-border p-4 text-left outline-none",
        "focus-visible:ring-2 focus-visible:ring-[#C56B70]/40",
        "border-l-[3px]",
        selected
          ? "border-l-[#C56B70] bg-[#FBF4F3]"
          : "border-l-transparent bg-surface",
      )}
    >
      <p className="text-[16px] font-semibold text-text">{pkg.nameSnapshot}</p>
      {selected ? (
        <p className="mt-1 text-[12px] font-medium text-[#C56B70]">已選擇</p>
      ) : null}
      <p className="mt-1 text-[13px] text-secondary-text">
        剩餘 <span className="tabular-nums text-text">{pkg.usableBalance}</span> 堂
      </p>
      <dl className="mt-3 space-y-1.5 text-[13px]">
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">本次療程</dt>
          <dd className="min-w-0 truncate text-right text-text">{serviceName}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">本次扣除</dt>
          <dd className="tabular-nums text-text">{POST_TREATMENT_REDEMPTION_SESSIONS} 堂</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-secondary-text">扣除後</dt>
          <dd className="tabular-nums text-text">{pkg.remainingAfterUse} 堂</dd>
        </div>
      </dl>
      <Button
        fullWidth
        size="lg"
        className="mt-4 min-h-11"
        data-use-package={pkg.customerPackageId}
        aria-label={`使用套票 ${pkg.nameSnapshot}`}
        onClick={(event) => {
          event.stopPropagation();
          onUse();
        }}
      >
        使用此套票
      </Button>
    </div>
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
  commerceRemoteRead = false,
  onBack,
  onComplete,
}: CompleteStepProps) {
  const router = useRouter();
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null);
  const [actionError, setActionError] = useState("");

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

  const eligible = useMemo(() => {
    void commerceRev;
    if (commerceRemoteRead) return { status: "ok" as const, packages: [] };
    if (!isClient || !completed) return { status: "loading" as const };
    return loadEligiblePackagesForTreatment({
      organizationId: appointment.organizationId,
      customerId: appointment.customerId,
      serviceId: appointment.serviceId,
    });
  }, [
    appointment.customerId,
    appointment.organizationId,
    appointment.serviceId,
    commerceRemoteRead,
    commerceRev,
    completed,
    isClient,
  ]);

  const packages = eligible.status === "ok" ? eligible.packages : [];
  const selectedId =
    selectedPackageId && packages.some((pkg) => pkg.customerPackageId === selectedPackageId)
      ? selectedPackageId
      : (packages[0]?.customerPackageId ?? null);

  const nextAppointmentHref = buildNextAppointmentHref({
    customerId: appointment.customerId,
    serviceId: appointment.serviceId,
    staffId: appointment.staffId,
  });

  function goCheckout(customerPackageId?: string | null) {
    setActionError("");
    if (commerceRemoteRead) {
      router.push(
        buildCommerceCheckoutHref({
          appointmentId: appointment.id,
          treatmentId: draft.id,
        }),
      );
      return;
    }
    try {
      const result = applyPostTreatmentCheckoutIntent({
        organizationId: appointment.organizationId,
        appointmentId: appointment.id,
        createdByStaffId: appointment.staffId,
        treatmentId: draft.id,
        customerPackageId,
      });
      router.push(result.href);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "無法開啟結帳，請改走一般結帳。");
    }
  }

  const consultationFields = useMemo(() => loadConsultationFields(appointment.organizationId), [appointment.organizationId]);
  const answerLines = consultationFields.flatMap((field) => {
    const answer = draft.assessment.consultationAnswers?.[field.id];
    const value = Array.isArray(answer) ? answer.filter(Boolean).join("、") : answer;
    return value ? [{ label: field.label, value }] : [];
  });
  const detailLine = (label: string, value: string) => (
    <p key={label} className="mt-1 text-sm font-normal leading-relaxed text-secondary-text"><span className="font-medium text-text">{label}：</span>{value || "未填寫"}</p>
  );
  const summaryGrid = (
    <div className="mt-5 grid min-w-0 gap-3 sm:grid-cols-2">
      <SummaryCard title="01 今日評估">
        {detailLine("今日狀況", draft.assessment.concerns.join("、"))}
        {detailLine("本次保養重點", draft.assessment.clientFocus)}
        {answerLines.filter(item => consultationFields.find(f => f.label === item.label)?.section === "assessment").map(item => detailLine(item.label, item.value))}
        {detailLine("敏感程度", String(draft.assessment.sensitivityLevel))}
      </SummaryCard>
      <SummaryCard title="02 身體部位紀錄">
        {showBody ? <>
          {draft.bodyMarkers.map(marker => (
            <div key={marker.id} className="mt-2 border-b border-border/50 pb-2 last:border-0">
              {detailLine(getBodyAreaLabel(marker.area, template.bodyAreas), marker.conditions.join("、"))}
              {marker.note ? detailLine("部位備註", marker.note) : null}
            </div>
          ))}
          {draft.bodyMapNote ? detailLine("部位補充說明", draft.bodyMapNote) : null}
        </> : "未填寫"}
      </SummaryCard>
      <SummaryCard title="03 本次操作與產品">
        {detailLine("操作項目", operationLabels.join("、"))}
        {detailLine("實際使用產品", productLabels.join("、"))}
      </SummaryCard>
      <SummaryCard title="04 專業紀錄">
        {detailLine("美容師服務紀錄", draft.professionalNote)}
        {detailLine("客人療程後感受", draft.clientFeeling)}
        {draft.discomfortNote ? detailLine("不適情況", draft.discomfortNote) : null}
      </SummaryCard>
      <SummaryCard title="05 下次保養與追蹤">
        {detailLine("追蹤狀況", draft.followUp.tags.join("、"))}
        {detailLine("保養建議", draft.followUp.note)}
        {detailLine("建議下次保養日期", draft.followUp.suggestedDate ? formatDateInput(draft.followUp.suggestedDate) : "")}
        {answerLines.filter(item => consultationFields.find(f => f.label === item.label)?.section === "professionalNote").map(item => detailLine(item.label, item.value))}
      </SummaryCard>
      {showPhotos ? <SummaryCard title="照片紀錄（僅內部）">Before {beforeCount} · After {afterCount}</SummaryCard> : null}
    </div>
  );

  if (completed) {
    return (
      <div className="mx-auto w-full min-w-0 max-w-[1100px]" data-post-treatment-complete>
        <Card padding="lg" className="min-w-0 overflow-hidden text-center sm:text-left">
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
                  療程紀錄已完成
                </h1>
                {draft.mode === "QUICK" ? (
                  <span className="rounded-full bg-primary-light px-2.5 py-1 text-xs font-medium text-primary">
                    快速紀錄
                  </span>
                ) : null}
              </div>
              <p className="mt-4 text-[15px] text-text">
                <span className="text-secondary-text">本次療程</span>
                <span className="mx-2 text-border">·</span>
                <span className="font-semibold">{appointment.serviceName}</span>
              </p>
            </div>
          </div>

          {summaryGrid}

          {commerceRemoteRead ? (
            <p className="mt-8 text-left text-[14px] leading-relaxed text-secondary-text">
              療程已完成，可前往待結帳。此階段不會建立本地結帳草稿，也不會收款。
            </p>
          ) : (
          <section className="mt-8 min-w-0 text-left" data-eligible-packages>
            <h2 className="text-[15px] font-semibold text-text">付款方式</h2>
            {eligible.status === "loading" ? (
              <p className="mt-3 text-[15px] text-secondary-text">載入套票資料…</p>
            ) : null}
            {eligible.status === "error" ? (
              <div className="mt-3 rounded-2xl bg-[#F7E8E8] px-4 py-3">
                <p className="text-sm text-[#B15B5B]" role="alert">
                  {eligible.message || PACKAGE_ELIGIBILITY_ERROR_MESSAGE}
                </p>
              </div>
            ) : null}
            {eligible.status === "ok" && packages.length === 0 ? (
              <p className="mt-3 text-[15px] text-secondary-text">
                目前沒有可使用的套票
              </p>
            ) : null}
            {eligible.status === "ok" && packages.length > 0 ? (
              <div
                role="listbox"
                aria-label="可使用套票"
                className="mt-4 grid min-w-0 grid-cols-1 gap-3 min-[820px]:grid-cols-2"
              >
                <p className="text-[13px] font-medium text-secondary-text min-[820px]:col-span-2">
                  可使用套票
                </p>
                {packages.map((pkg) => (
                  <PackageSelectCard
                    key={pkg.customerPackageId}
                    pkg={pkg}
                    serviceName={appointment.serviceName}
                    selected={pkg.customerPackageId === selectedId}
                    onSelect={() => setSelectedPackageId(pkg.customerPackageId)}
                    onUse={() => goCheckout(pkg.customerPackageId)}
                  />
                ))}
              </div>
            ) : null}
          </section>
          )}

          {actionError ? (
            <p className="mt-4 rounded-2xl bg-[#F7E8E8] px-4 py-3 text-sm text-[#B15B5B]" role="alert">
              {actionError}
            </p>
          ) : null}

          <section className="mt-6 rounded-2xl border border-[#E9D7D4] bg-[#FBF6F5] p-4 text-left">
            <h2 className="text-[15px] font-semibold text-text">會員歷史保養紀錄</h2>
            <p className="mt-1 text-[13px] leading-relaxed text-secondary-text">已完成的療程會依指定欄位自動提供給對應會員查看，不需店長逐筆審核；照片與內部操作紀錄不會同步。</p>
          </section>

          <div className="mt-8 flex min-w-0 flex-col gap-3 sm:flex-row-reverse sm:flex-wrap sm:justify-start">
            {eligible.status === "ok" && packages.length > 0 ? (
              <Button
                variant="outline"
                fullWidth
                size="lg"
                className="sm:min-w-[12rem] sm:w-auto"
                data-checkout-regular
                onClick={() => goCheckout(null)}
              >
                改用其他付款方式
              </Button>
            ) : (
              <Button
                fullWidth
                size="lg"
                className="sm:min-w-[12rem] sm:w-auto"
                data-checkout-regular
                onClick={() => goCheckout(undefined)}
              >
                前往結帳
              </Button>
            )}
            <Link href={nextAppointmentHref} className="block min-w-0 sm:min-w-[12rem]">
              <Button variant="outline" fullWidth size="lg">
                安排下次預約
              </Button>
            </Link>
            <Link href="/staff/today" className="block min-w-0 sm:min-w-[12rem]">
              <Button variant="ghost" fullWidth size="lg">
                返回今日
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
        <p className="mt-2 text-[15px] text-secondary-text">請逐項確認實際填寫內容，儲存完成後指定欄位將自動顯示於會員歷史保養紀錄</p>
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
