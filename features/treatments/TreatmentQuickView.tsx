"use client";

import Link from "next/link";
import { useState } from "react";
import {
  AlertCircle,
  ChevronRight,
  Crown,
  Play,
  UserRound,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { MEMBERSHIP_LABEL, cn } from "@/lib/utils";
import {
  collectTreatmentAttentionNotes,
  deriveLastCompletedTreatment,
  deriveTreatmentPrimaryCta,
  formatAppointmentRange,
  recordSectionHref,
  resolveTreatmentQuickViewCheckoutHref,
  resolveTreatmentQuickViewSettledHref,
  visitCountLabel,
  type TreatmentCatalogHint,
  type TreatmentWorkspaceItem,
} from "@/lib/treatments/treatment-workspace-derived";
import type { Customer } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";

const WORKSPACE_RADIUS_CLASS = "rounded-2xl";
const ROSE_FILL = "bg-[#C56B70]";
const ROSE_HOVER = "hover:bg-[#B85F64]";

const STATUS_PILL: Record<TreatmentWorkspaceItem["status"]["kind"], string> = {
  in_progress: "bg-[#F3E6E5] text-[#C56B70]",
  record_incomplete: "bg-[#F6EDE0] text-[#C08A3E]",
  not_started: "bg-[#F1EEEC] text-[#7A7272]",
  completed: "bg-[#E7F0EA] text-[#5C7F66]",
};

interface TreatmentQuickViewProps {
  item: TreatmentWorkspaceItem;
  customer: Customer | null;
  catalog: TreatmentCatalogHint[];
  completedTreatments: TreatmentDraft[];
  organizationId: string;
  paidAppointmentIds?: ReadonlyMap<string, string>;
  onClose: () => void;
}

export function TreatmentQuickView({
  item,
  customer,
  catalog,
  completedTreatments,
  organizationId: _organizationId,
  paidAppointmentIds,
  onClose,
}: TreatmentQuickViewProps) {
  void _organizationId;
  const [tab, setTab] = useState<"record" | "full">("record");
  const membership = item.membership;
  const membershipText = customer
    ? MEMBERSHIP_LABEL[customer.membership]
    : membership?.id === "vip"
      ? "VIP會員"
      : membership?.id === "new"
        ? "新客"
        : null;
  const visitLabel = visitCountLabel(customer?.totalVisits);
  const range = formatAppointmentRange(item.startAt, item.endAt);
  const last = deriveLastCompletedTreatment({
    completedTreatments,
    customerId: item.customerId,
    catalog,
    excludeAppointmentId: item.appointmentId || undefined,
    excludeTreatmentId: item.draft?.id,
  });
  const attention = collectTreatmentAttentionNotes({
    customer,
    appointmentNotes: item.appointment?.notes,
    appointmentCustomerNote:
      item.appointment?.customerNote ?? item.appointment?.internalNote,
    currentDraft: item.kind === "completed" ? null : item.draft,
    latestCompleted: completedTreatments.find(
      (treatment) =>
        treatment.customerId === item.customerId &&
        treatment.id !== item.draft?.id,
    ),
  });
  const primary = deriveTreatmentPrimaryCta(item);
  const checkoutHref = resolveTreatmentQuickViewCheckoutHref(item, {
    paidAppointmentIds,
  });
  const settledHref = resolveTreatmentQuickViewSettledHref(item, paidAppointmentIds);
  const profileHref = item.customerId
    ? `/staff/customers/${item.customerId}`
    : "";
  const interestTags = (customer?.tags ?? []).filter((tag) =>
    ["facial", "breast", "body"].includes(tag.id),
  );

  return (
    <>
      <button
        type="button"
        className="fixed inset-0 z-40 bg-text/25 min-[1200px]:hidden"
        aria-label="關閉療程摘要"
        onClick={onClose}
      />
      <aside
        data-treatment-quickview
        role="dialog"
        aria-modal="true"
        aria-label={`${item.customerName}的療程摘要`}
        className={cn(
          "z-50 flex flex-col overflow-hidden border border-border bg-surface",
          "fixed inset-x-0 bottom-0 max-h-[88vh] rounded-t-3xl shadow-[0_-4px_24px_rgba(48,43,43,0.08)]",
          "min-[1200px]:relative min-[1200px]:inset-auto min-[1200px]:z-0 min-[1200px]:sticky min-[1200px]:top-6 min-[1200px]:h-auto min-[1200px]:max-h-[calc(100dvh-3rem)] min-[1200px]:w-[325px] min-[1200px]:min-w-[325px] min-[1200px]:shrink-0 min-[1200px]:shadow-none",
          WORKSPACE_RADIUS_CLASS,
        )}
      >
        <div className="flex shrink-0 items-center justify-end px-5 pt-3.5 pb-1">
          <button
            type="button"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex shrink-0 items-start gap-3 px-5 pb-2.5">
          <div
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-primary/12 text-[15px] font-semibold text-primary"
            aria-hidden
          >
            {item.customerInitials}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="whitespace-nowrap text-[16px] font-semibold text-text">
                {item.customerName}
              </h2>
              {membership ? (
                <Badge
                  tone={membership.id === "vip" ? "vip" : "new"}
                  className="px-1.5 py-px text-[10px]"
                >
                  {membership.id === "vip" ? (
                    <Crown className="mr-0.5 h-2.5 w-2.5" aria-hidden />
                  ) : null}
                  {membership.label}
                </Badge>
              ) : null}
            </div>
            {membershipText ? (
              <p className="mt-0.5 text-[12px] text-[#6E6666]">
                {membershipText}
              </p>
            ) : null}
            {item.customerPhone ? (
              <p className="whitespace-nowrap text-[12px] text-[#6E6666]">
                {item.customerPhone}
              </p>
            ) : null}
            {visitLabel ? (
              <p className="text-[12px] text-[#6E6666]">{visitLabel}</p>
            ) : null}
            {interestTags.length > 0 ? (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {interestTags.map((tag) => (
                  <span
                    key={tag.id}
                    className="rounded-full bg-[#F6F1EE] px-1.5 py-px text-[10px] text-secondary-text"
                  >
                    {tag.label}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 px-5 pb-2.5">
          <span
            className={cn(
              "inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium",
              STATUS_PILL[item.status.kind],
            )}
          >
            {item.status.title}
          </span>
          <p className="min-w-0 truncate text-[12px] text-[#6E6666]">
            {item.status.detail}
          </p>
        </div>

        <div className="flex shrink-0 gap-5 border-b border-border px-5">
          <button
            type="button"
            onClick={() => setTab("record")}
            className={cn(
              "-mb-px border-b-2 pb-1.5 text-[13px] font-medium",
              tab === "record"
                ? "border-[#C56B70] text-[#C56B70]"
                : "border-transparent text-secondary-text hover:text-text",
            )}
          >
            療程紀錄
          </button>
          {profileHref ? (
            <Link
              href={profileHref}
              className={cn(
                "-mb-px border-b-2 pb-1.5 text-[13px] font-medium",
                tab === "full"
                  ? "border-[#C56B70] text-[#C56B70]"
                  : "border-transparent text-secondary-text hover:text-text",
              )}
              onClick={() => setTab("full")}
            >
              完整資料
            </Link>
          ) : (
            <span className="-mb-px border-b-2 border-transparent pb-1.5 text-[13px] text-secondary-text">
              完整資料
            </span>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3.5">
          <section className="rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-text">本次療程</p>
            <dl className="mt-2 space-y-2 text-[13px]">
              <InfoRow label="服務項目" value={item.serviceName} />
              {range ? <InfoRow label="預約時間" value={range} /> : null}
              {item.durationMinutes ? (
                <InfoRow label="服務時長" value={`${item.durationMinutes} 分鐘`} />
              ) : null}
              {item.staffName ? (
                <InfoRow label="美容師" value={item.staffName} />
              ) : null}
            </dl>
          </section>

          <section className="mt-3.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold text-text">療程紀錄完成度</p>
              <p className="text-[12px] tabular-nums text-[#6E6666]">
                {item.record.completedCount} / {item.record.totalCount}
              </p>
            </div>
            <div
              className="mt-2 h-[3px] overflow-hidden rounded-full bg-[#EFE8E4]"
              role="progressbar"
              aria-label="療程紀錄完成度"
              aria-valuemin={0}
              aria-valuemax={item.record.totalCount}
              aria-valuenow={item.record.completedCount}
            >
              <div
                className="h-full rounded-full bg-[#C56B70]/80"
                style={{
                  width: `${
                    item.record.totalCount > 0
                      ? (item.record.completedCount / item.record.totalCount) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            <ul className="mt-2.5 space-y-1.5">
              {item.record.sections.map((section) => {
                const href = recordSectionHref({
                  customerId: item.customerId,
                  appointmentId: item.appointmentId,
                  completed: item.kind === "completed",
                  treatmentId: item.draft?.id,
                });
                return (
                  <li
                    key={section.id}
                    className="flex items-center justify-between gap-2 text-[12px]"
                  >
                    <span className="inline-flex items-center gap-1.5 text-text">
                      <span
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          section.complete
                            ? "bg-[#7A9480]"
                            : "border border-[#C9BEB8] bg-transparent",
                        )}
                        aria-hidden
                      />
                      {section.label}
                    </span>
                    {item.appointmentId && item.customerId ? (
                      <Link
                        href={href}
                        className="text-[12px] font-medium text-[#C56B70] hover:text-[#B85F64]"
                      >
                        {section.complete ? "查看" : "填寫"}
                      </Link>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {attention.length > 0 ? (
            <section className="mt-3.5 rounded-2xl bg-[#F8F1F1] px-3.5 py-2.5">
              <p className="flex items-center gap-1.5 text-[13px] font-semibold text-[#B15B5B]">
                <AlertCircle className="h-3.5 w-3.5" aria-hidden />
                本次重點
              </p>
              <ul className="mt-2 space-y-1">
                {attention.map((note) => (
                  <li
                    key={note}
                    className="flex gap-2 text-[12px] leading-relaxed text-secondary-text"
                  >
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[#C9797D]" />
                    <span>{note}</span>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section className="mt-3.5 rounded-2xl bg-[#FAF7F5] px-3.5 py-3">
            <p className="text-[13px] font-semibold text-text">上次療程</p>
            {last ? (
              <div className="mt-2">
                <p className="text-[12px] text-[#6E6666]">
                  {last.dateLabel} · {last.serviceName}
                  {last.durationLabel ? ` · ${last.durationLabel}` : ""}
                </p>
                {last.note ? (
                  <p className="mt-1 text-[13px] leading-relaxed text-text">
                    「{last.note}」
                  </p>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-secondary-text">
                尚無過往療程紀錄
              </p>
            )}
          </section>
        </div>

        <div className="shrink-0 space-y-1.5 px-5 pt-1.5 pb-5">
          <Link
            href={primary.href}
            className={cn(
              "inline-flex h-[50px] min-h-[50px] w-full items-center justify-center gap-1.5 rounded-full text-[15px] font-medium text-white transition-colors",
              ROSE_FILL,
              ROSE_HOVER,
            )}
          >
            {primary.kind === "view" ? (
              <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            ) : (
              <Play className="h-3.5 w-3.5" aria-hidden />
            )}
            {primary.label}
          </Link>
          <div className="flex flex-col gap-0.5">
            {profileHref ? (
              <Link href={profileHref} className="block">
                <Button
                  variant="ghost"
                  className="h-9 min-h-9 w-full rounded-full text-[13px] font-normal text-secondary-text hover:text-text"
                >
                  <UserRound className="h-3.5 w-3.5" aria-hidden />
                  查看客戶資料
                </Button>
              </Link>
            ) : null}
            {settledHref ? (
              <Link
                href={settledHref}
                data-treatment-settled-href={settledHref}
                className="block"
              >
                <Button
                  variant="ghost"
                  className="h-9 min-h-9 w-full rounded-full text-[13px] font-normal text-secondary-text hover:text-text"
                >
                  已結帳
                </Button>
              </Link>
            ) : checkoutHref ? (
              <Link
                href={checkoutHref}
                data-treatment-checkout-href={checkoutHref}
                className="block"
              >
                <Button
                  variant="ghost"
                  className="h-9 min-h-9 w-full rounded-full text-[13px] font-normal text-secondary-text hover:text-text"
                >
                  前往結帳
                </Button>
              </Link>
            ) : null}
          </div>
        </div>
      </aside>
    </>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-[#7A7272]">{label}</dt>
      <dd className="text-right font-medium text-text">{value}</dd>
    </div>
  );
}
