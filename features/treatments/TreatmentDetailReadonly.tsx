"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowLeft } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { getServiceById } from "@/data/mock-services";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import type { TreatmentDraft } from "@/types/treatment";

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

interface TreatmentDetailReadonlyProps {
  treatmentId: string;
}

export function TreatmentDetailReadonly({ treatmentId }: TreatmentDetailReadonlyProps) {
  const isClient = useIsClient();
  const { organization, membership } = useOrganization();
  const treatment = useCrmJson(
    () =>
      localTreatmentRepository.getById({
        organizationId: organization.id,
        id: treatmentId,
      }) ?? null,
    null as TreatmentDraft | null,
  );

  const service = useMemo(
    () => (treatment ? getServiceById(treatment.serviceId, organization.id) : undefined),
    [treatment, organization.id],
  );
  const customer = useMemo(
    () =>
      treatment
        ? localCustomerRepository.getById({
            organizationId: organization.id,
            id: treatment.customerId,
          })
        : undefined,
    [treatment, organization.id],
  );

  if (!isClient) {
    return <div className="h-40 animate-pulse rounded-2xl bg-primary-light/40" />;
  }

  if (!treatment) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">找不到此療程紀錄</p>
        <p className="mt-2 text-sm text-secondary-text">
          Access unavailable — 此紀錄不屬於目前店家，或資料不存在。
        </p>
        <Link href="/staff/customers" className="mt-3 inline-flex min-h-11 items-center text-primary">
          返回客戶管理
        </Link>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Link
        href={customer ? `/staff/customers/${customer.id}` : "/staff/customers"}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text"
      >
        <ArrowLeft className="h-4 w-4" />
        {customer ? `返回 ${customer.name}` : "返回客戶管理"}
      </Link>

      <Card padding="lg">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-sm text-secondary-text">療程紀錄（唯讀）</p>
            <h1 className="mt-1 text-2xl font-semibold text-text">
              {service?.name ?? "療程"}
            </h1>
            <p className="mt-2 text-[15px] text-secondary-text">
              {formatDateTime(treatment.updatedAt)}
            </p>
          </div>
          <Badge tone="success">已完成</Badge>
        </div>

        <dl className="mt-6 grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-sm text-secondary-text">客戶</dt>
            <dd className="mt-1 font-medium text-text">{customer?.name ?? treatment.customerId}</dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">美容師</dt>
            <dd className="mt-1 font-medium text-text">
              {membership?.displayName ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">模式</dt>
            <dd className="mt-1 font-medium text-text">
              {treatment.mode === "QUICK" ? "快速紀錄" : "標準流程"}
            </dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">操作時間</dt>
            <dd className="mt-1 font-medium text-text">{formatDateTime(treatment.updatedAt)}</dd>
          </div>
        </dl>
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-base font-semibold text-text">評估摘要</h2>
        <p className="text-[15px] text-text">
          關注：{treatment.assessment.concerns.join("、") || "—"}
        </p>
        {treatment.assessment.clientFocus ? (
          <p className="text-[15px] text-secondary-text">{treatment.assessment.clientFocus}</p>
        ) : null}
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-base font-semibold text-text">操作與產品</h2>
        <p className="text-[15px] text-text">操作：{treatment.operations.join("、") || "—"}</p>
        <p className="text-[15px] text-text">產品：{treatment.products.join("、") || "—"}</p>
        <p className="text-[15px] text-text">
          重點部位：
          {treatment.suggestedTrackingAreas.join("、") ||
            treatment.bodyMarkers.map((m) => m.area).join("、") ||
            "—"}
        </p>
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-base font-semibold text-text">專業摘要</h2>
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-text">
          {treatment.professionalNote || "—"}
        </p>
        <p className="text-[15px] text-secondary-text">
          客戶感受：{treatment.clientFeeling || "—"}
        </p>
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-base font-semibold text-text">Follow Up</h2>
        <p className="text-[15px] text-text">
          {treatment.followUp.tags.join("、") || "—"}
        </p>
        {treatment.followUp.note ? (
          <p className="text-[15px] text-secondary-text">{treatment.followUp.note}</p>
        ) : null}
        {treatment.followUp.suggestedDate ? (
          <p className="text-sm text-secondary-text">
            建議回訪：{treatment.followUp.suggestedDate}
          </p>
        ) : null}
      </Card>

      <p className="text-center text-xs text-secondary-text">僅供內部服務紀錄使用 · Prototype 唯讀</p>
    </div>
  );
}
