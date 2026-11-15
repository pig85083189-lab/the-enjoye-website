"use client";

import Link from "next/link";
import { useMemo } from "react";
import { loadConsultationFields } from "@/lib/consultation-settings";
import { ArrowLeft, CalendarDays, ClipboardList, HeartPulse, Image as ImageIcon, MapPinned, Sparkles, UserRound, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getServiceById } from "@/data/mock-services";
import { BREAST_TEMPLATE, GENERIC_TEMPLATE, getTreatmentTemplateForService } from "@/data/treatment-templates";
import { useTreatmentCustomerIdentity } from "@/features/treatments/use-treatment-customer-identity";
import { useTreatmentRemoteDetail } from "@/features/treatments/use-treatment-remote-read";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  resolveCanonicalServiceDisplayName,
  resolveCanonicalStaffDisplayName,
} from "@/lib/treatments/treatment-display";
import type { TreatmentDraft } from "@/types/treatment";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface TreatmentDetailReadonlyProps {
  treatmentId: string;
  customerRemoteReadPilot?: boolean;
  treatmentRemoteReadPilot?: boolean;
}

export function TreatmentDetailReadonly({
  treatmentId,
  customerRemoteReadPilot = false,
  treatmentRemoteReadPilot = false,
}: TreatmentDetailReadonlyProps) {
  const isClient = useIsClient();
  const { organization, membership } = useOrganization();
  const localTreatment = useCrmJson(
    () =>
      treatmentRemoteReadPilot
        ? null
        : localTreatmentRepository.getById({
            organizationId: organization.id,
            id: treatmentId,
          }) ?? null,
    null as TreatmentDraft | null,
  );
  const remoteTreatment = useTreatmentRemoteDetail(
    organization.id,
    treatmentId,
    treatmentRemoteReadPilot,
  );
  const treatment = treatmentRemoteReadPilot
    ? remoteTreatment.status === "data"
      ? remoteTreatment.value
      : null
    : localTreatment;

  const service = useMemo(
    () => (treatment ? getServiceById(treatment.serviceId, organization.id) : undefined),
    [treatment, organization.id],
  );
  const serviceName = resolveCanonicalServiceDisplayName({
    serviceId: treatment?.serviceId ?? "",
    catalogName: service?.name,
  });
  const staffName = resolveCanonicalStaffDisplayName({
    staffId: treatment?.staffId ?? "",
    rosterName: treatment
      ? getMembership(organization.id, treatment.staffId)?.displayName
      : membership?.displayName,
  });
  const customerIdentity = useTreatmentCustomerIdentity({
    organizationId: organization.id,
    customerId: treatment?.customerId ?? "",
    customerRemoteReadPilot,
  });
  const customer =
    customerIdentity.status === "ready" ? customerIdentity.customer : undefined;

  if (!isClient || (treatmentRemoteReadPilot && remoteTreatment.status === "loading")) {
    return <div className="h-40 animate-pulse rounded-2xl bg-primary-light/40" />;
  }

  if (treatmentRemoteReadPilot && remoteTreatment.status === "error") {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">找不到此療程紀錄</p>
        <p className="mt-2 text-sm text-secondary-text">
          請稍後再試。
        </p>
      </Card>
    );
  }

  if (!treatment) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">找不到此療程紀錄</p>
        <p className="mt-2 text-sm text-secondary-text">
          此紀錄不屬於目前店家，或資料不存在。
        </p>
        <Link href="/staff/customers" className="mt-3 inline-flex min-h-11 items-center text-primary">
          返回客戶管理
        </Link>
      </Card>
    );
  }

  const operationLabels = new Map(
    [GENERIC_TEMPLATE, BREAST_TEMPLATE, getTreatmentTemplateForService(treatment.serviceId, organization.id)]
      .flatMap((template) => template.operationGroups.flatMap((group) => group.items))
      .map((item) => [item.id, item.label]),
  );
  const displayOperations = treatment.operations.map((item) => operationLabels.get(item) ?? (item.startsWith("op-") ? "未識別的舊操作項目" : item)).join("、");
  const markers = treatment.bodyMarkers ?? [];
  const focusAreas = treatment.suggestedTrackingAreas?.length
    ? treatment.suggestedTrackingAreas
    : markers.map((marker) => marker.area);
  const configuredFields = loadConsultationFields(organization.id);
  const consultationAnswers = treatment.assessment.consultationAnswers ?? {};
  const configuredAnswers = configuredFields.flatMap(def => {
    const raw = consultationAnswers[def.id];
    const value = Array.isArray(raw) ? raw.filter(Boolean).join("、") : raw;
    return value ? [{id:def.id,label:def.label,section:def.section,value}] : [];
  });
  const detailRow = (label: string, value: string) => value ? (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-[#F1E6E4] py-3 last:border-0 sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-[#94666F]">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-text">{value}</dd>
    </div>
  ) : null;
  const cardTitle = (Icon: typeof ClipboardList, title: string) => (
    <h2 className="flex items-center gap-2 text-base font-semibold text-[#552F3D]">
      <Icon className="h-5 w-5 text-[#B77781]" aria-hidden="true" />{title}
    </h2>
  );

  return (
    <div
      className="mx-auto max-w-4xl space-y-4 pb-6"
      data-customer-identity-source={customerRemoteReadPilot ? "remote-pilot" : "local"}
      data-treatment-record-source={treatmentRemoteReadPilot ? "remote-pilot" : "local"}
    >
      <Link href={customer ? `/staff/customers/${customer.id}` : "/staff/customers"}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text">
        <ArrowLeft className="h-4 w-4" />{customer ? `返回 ${customer.name}` : "返回客戶管理"}
      </Link>

      <header className="text-center">
        <h1 className="text-xl font-semibold text-[#552F3D] sm:text-2xl">查看完整療程紀錄</h1>
        <p className="mt-1 text-sm text-secondary-text">回顧上次評估、實際操作與下次追蹤重點</p>
      </header>

      <Card padding="lg" className="border-[#F0DFDF]">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#F8E9EB] text-[#B77781]"><UserRound className="h-6 w-6" /></span>
          <div className="min-w-0 flex-1">
            <p className="text-lg font-semibold text-[#552F3D]">{customer?.name ?? "顧客紀錄"}</p>
            <p className="text-xs text-secondary-text">{serviceName}</p>
          </div>
          <Badge tone="success">已完成</Badge>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F1E6E4] pt-4 text-sm text-secondary-text">
          <CalendarDays className="h-4 w-4 text-[#B77781]" />
          <span>{formatDateTime(treatment.updatedAt)}</span>
          <span className="rounded-full bg-[#F8E9EB] px-2 py-1 text-xs text-[#94666F]">{treatment.mode === "QUICK" ? "快速紀錄" : "標準流程"}</span>
        </div>
      </Card>

      <nav aria-label="療程紀錄快速導覽" className="flex gap-2 overflow-x-auto rounded-2xl border border-[#F0DFDF] bg-white p-2">
        <a href="#member-visible" className="shrink-0 rounded-xl bg-[#EDF6EF] px-3 py-2 text-sm font-medium text-[#426A52]">會員可見紀錄</a>
        <a href="#internal-only" className="shrink-0 rounded-xl bg-[#F9F0F0] px-3 py-2 text-sm font-medium text-[#94666F]">店內專用紀錄</a>
      </nav>

      <section id="member-visible" className="scroll-mt-5 space-y-4">
        <div className="rounded-2xl border border-[#C9DDD1] bg-[#F2F8F3] p-4">
          <h2 className="flex items-center gap-2 font-semibold text-[#426A52]">01 會員可見紀錄</h2>
          <p className="mt-1 text-sm text-secondary-text">已完成療程的指定欄位會提供給對應會員查看。</p>
        </div>
        <Card padding="lg" className="space-y-3 border-[#C9DDD1]">
          {cardTitle(Sparkles,"今日評估")}
          <dl>
            {configuredAnswers.filter(a=>a.section==="assessment").map(a=><div key={a.id}>{detailRow(a.label,a.value)}</div>)}
            {!configuredAnswers.some(a=>a.section==="assessment") && <p className="text-sm text-secondary-text">本次沒有填寫今日評估自訂欄位。</p>}
          </dl>
        </Card>
        <Card padding="lg" className="space-y-3 border-[#C9DDD1]">
          {cardTitle(MapPinned,"身體部位紀錄")}
          {markers.length ? <div className="grid gap-3 sm:grid-cols-2">{markers.map(marker =>
            <div key={marker.id} className="rounded-xl border border-[#E1EDE4] bg-[#F8FBF8] p-3">
              <p className="font-semibold text-[#426A52]">{marker.area}</p>
              {marker.conditions.length>0 && <p className="mt-1 text-sm text-text">{marker.conditions.join("、")}</p>}
              {marker.note && <p className="mt-2 whitespace-pre-wrap text-sm text-secondary-text">{marker.note}</p>}
            </div>
          )}</div> : <p className="text-sm text-secondary-text">本次沒有身體部位標記。</p>}
          <dl>{detailRow("部位補充說明",treatment.bodyMapNote)}</dl>
        </Card>
        <Card padding="lg" className="space-y-3 border-[#C9DDD1]">
          {cardTitle(HeartPulse,"專業紀錄")}
          <dl>{detailRow("美容師服務紀錄",treatment.professionalNote)}
            {detailRow("顧客療程後感受",treatment.clientFeeling)}
            {detailRow("不適情況",treatment.discomfortNote)}</dl>
        </Card>
        <Card padding="lg" className="space-y-3 border-[#C9DDD1]">
          {cardTitle(CalendarDays,"下次追蹤")}
          <dl>{detailRow("保養建議",treatment.followUp.note)}
            {detailRow("建議下次保養日期",treatment.followUp.suggestedDate)}
            {configuredAnswers.filter(a=>["next-course","recommendation-reason","next-care-date"].includes(a.id)).map(a=><div key={a.id}>{detailRow(a.label,a.value)}</div>)}</dl>
        </Card>
      </section>

      <section id="internal-only" className="scroll-mt-5 space-y-4">
        <div className="rounded-2xl border border-[#F0DFDF] bg-[#FBF5F5] p-4">
          <h2 className="font-semibold text-[#704351]">02 店內專用紀錄</h2>
          <p className="mt-1 text-sm text-secondary-text">僅供 Beauty OS 授權員工查看，不同步會員系統。</p>
        </div>
        <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(ClipboardList,"本次操作與產品")}
          <dl>{detailRow("操作項目",displayOperations)}{detailRow("實際使用產品",treatment.products.join("、"))}</dl>
        </Card>
        <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(ImageIcon,"療程照片")}
          <p className="text-xs text-secondary-text">照片僅顯示紀錄數量，不公開至會員。</p>
          <div className="grid grid-cols-2 gap-3">{(["BEFORE","AFTER"] as const).map(type=>{
            const count=treatment.photos.filter(photo=>photo.type===type).length;
            return <div key={type} className="rounded-xl bg-[#FBF5F5] p-4 text-center"><ImageIcon className="mx-auto h-7 w-7 text-[#C49BA3]"/><p className="mt-2 text-sm font-medium">{type==="BEFORE"?"操作前":"操作後"}</p><p className="mt-1 text-xs text-secondary-text">{count} 張</p></div>;
          })}</div>
        </Card>
        {(treatment.assessment.concerns.length>0||treatment.assessment.clientFocus||treatment.followUp.tags.length>0||focusAreas.length>0) && <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(ClipboardList,"其他店內紀錄")}
          <dl>{detailRow("舊版客戶主訴",treatment.assessment.concerns.join("、"))}
            {detailRow("舊版評估重點",treatment.assessment.clientFocus)}
            {detailRow("追蹤標籤",treatment.followUp.tags.join("、"))}
            {detailRow("建議追蹤部位",focusAreas.join("、"))}</dl>
        </Card>}
      </section>
    </div>
  );
}
