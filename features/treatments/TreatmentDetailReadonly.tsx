"use client";

import Link from "next/link";
import { useMemo } from "react";
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
  const detailRow = (label: string, value: string) => (
    <div className="grid grid-cols-[92px_minmax(0,1fr)] gap-3 border-b border-[#F1E6E4] py-3 last:border-0 sm:grid-cols-[140px_minmax(0,1fr)]">
      <dt className="text-sm font-medium text-[#94666F]">{label}</dt>
      <dd className="min-w-0 whitespace-pre-wrap break-words text-sm leading-6 text-text">{value || "未紀錄"}</dd>
    </div>
  );
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
        {[
          {id:"record-summary", label:"重點摘要"},
          {id:"record-body", label:"身體紀錄"},
          {id:"record-details", label:"詳細紀錄"},
          {id:"record-followup", label:"後續追蹤"}
        ].map(item => <a key={item.id} href={`#${item.id}`} className="shrink-0 rounded-xl bg-[#F9F0F0] px-3 py-2 text-sm font-medium text-[#94666F]">{item.label}</a>)}
      </nav>

      <section id="record-summary" className="scroll-mt-5">
        <Card padding="lg" className="space-y-4 border-[#F0DFDF]">
          {cardTitle(Sparkles,"本次療程重點摘要")}
          <div className="space-y-3 rounded-xl bg-[#FBF5F5] p-4">
            <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#B77781]"/><div><p className="text-xs font-semibold text-[#94666F]">客戶關注</p><p className="mt-1 text-sm leading-6 text-text">{treatment.assessment.concerns.join("、") || "未紀錄"}</p></div></div>
            <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#B77781]"/><div><p className="text-xs font-semibold text-[#94666F]">本次目標</p><p className="mt-1 text-sm leading-6 text-text">{treatment.assessment.clientFocus || "未紀錄"}</p></div></div>
            <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#B77781]"/><div><p className="text-xs font-semibold text-[#94666F]">實際操作</p><p className="mt-1 text-sm leading-6 text-text">{displayOperations || "未紀錄"}</p></div></div>
            <div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-[#B77781]"/><div><p className="text-xs font-semibold text-[#94666F]">客戶感受</p><p className="mt-1 text-sm leading-6 text-text">{treatment.clientFeeling || "未紀錄"}</p></div></div>
          </div>
        </Card>
      </section>

      <section id="record-body" className="scroll-mt-5">
        <Card padding="lg" className="space-y-4 border-[#F0DFDF]">
          {cardTitle(MapPinned,"身體紀錄（Body Map）")}
          <p className="text-xs text-secondary-text">以下為本次實際標記的部位與狀況，不以示意圖取代原始紀錄。</p>
          {markers.length ? <div className="grid gap-3 sm:grid-cols-2">{markers.map(marker =>
            <div key={marker.id} className="rounded-xl border border-[#F0DFDF] bg-[#FCF8F8] p-3">
              <p className="font-semibold text-[#704351]">{marker.area}</p>
              <p className="mt-1 text-sm text-text">{marker.conditions.join("、") || "未標記狀況"}</p>
              {marker.note && <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-secondary-text">{marker.note}</p>}
            </div>
          )}</div> : <p className="rounded-xl bg-[#FBF5F5] p-4 text-sm text-secondary-text">本次沒有標記身體部位。</p>}
          <dl>{detailRow("部位備註",treatment.bodyMapNote)}{detailRow("不適紀錄",treatment.discomfortNote)}{detailRow("下次留意",focusAreas.join("、"))}</dl>
        </Card>
      </section>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(HeartPulse,"療程資訊")}
          <dl>{detailRow("療程項目",serviceName)}{detailRow("美容師",staffName)}{detailRow("使用產品",treatment.products.join("、"))}</dl>
        </Card>
        <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(ImageIcon,"療程照片")}
          <p className="text-xs text-secondary-text">照片依照原始療程紀錄顯示。</p>
          <div className="grid grid-cols-2 gap-3">
            {(["BEFORE","AFTER"] as const).map(type => {
              const count=treatment.photos.filter(photo=>photo.type===type).length;
              return <div key={type} className="rounded-xl bg-[#FBF5F5] p-4 text-center">
                <ImageIcon className="mx-auto h-7 w-7 text-[#C49BA3]" />
                <p className="mt-2 text-sm font-medium text-[#704351]">{type==="BEFORE"?"操作前":"操作後"}</p>
                <p className="mt-1 text-xs text-secondary-text">{count ? `已紀錄 ${count} 張` : "未紀錄"}</p>
              </div>;
            })}
          </div>
          <p className="text-xs text-secondary-text">此頁僅顯示照片數量，避免在未取得有效照片網址時顯示錯誤圖片。</p>
        </Card>
      </div>

      <section id="record-details" className="scroll-mt-5">
        <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(ClipboardList,"詳細紀錄")}
          <dl>{detailRow("客戶主訴",treatment.assessment.concerns.join("、"))}
          {detailRow("評估重點",treatment.assessment.clientFocus)}
          {detailRow("敏感程度",String(treatment.assessment.sensitivityLevel ?? "未紀錄"))}
          {detailRow("操作內容",displayOperations)}
          {detailRow("本次回饋",treatment.clientFeeling)}
          {detailRow("專業備註",treatment.professionalNote)}</dl>
        </Card>
      </section>

      <section id="record-followup" className="scroll-mt-5">
        <Card padding="lg" className="space-y-3 border-[#F0DFDF]">
          {cardTitle(CalendarDays,"後續追蹤與建議")}
          <dl>{detailRow("追蹤標籤",treatment.followUp.tags.join("、"))}
          {detailRow("追蹤備註",treatment.followUp.note)}
          {detailRow("建議回訪",treatment.followUp.suggestedDate)}
          {detailRow("建議再預約",treatment.followUp.suggestNextBooking ? "是" : "否")}</dl>
        </Card>
      </section>
    </div>
  );
}
