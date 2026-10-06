"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { getServiceById } from "@/data/mock-services";
import type { Service } from "@/types";
import {
  treatmentsFromRemoteListState,
  useTreatmentRemoteListByCustomer,
} from "@/features/treatments/use-treatment-remote-read";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  resolveCanonicalServiceDisplayName,
  resolveCanonicalStaffDisplayName,
} from "@/lib/treatments/treatment-display";
import type { TreatmentDraft } from "@/types/treatment";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

interface TreatmentsTabProps {
  customerId: string;
  treatmentHref?: string;
  treatmentRemoteReadPilot?: boolean;
  catalog?: Service[] | null;
}

export function TreatmentsTab({
  customerId,
  treatmentHref,
  treatmentRemoteReadPilot = false,
  catalog,
}: TreatmentsTabProps) {
  const { organization } = useOrganization();
  const remote = useTreatmentRemoteListByCustomer(
    organization.id,
    customerId,
    treatmentRemoteReadPilot,
  );
  const treatments = treatmentRemoteReadPilot
    ? treatmentsFromRemoteListState(remote)
    : localTreatmentRepository.listByCustomer({
        organizationId: organization.id,
        customerId,
      });

  if (treatmentRemoteReadPilot && remote.status === "loading") {
    return (
      <div
        className="h-32 animate-pulse rounded-2xl bg-primary-light/40"
        data-treatment-record-source="remote-pilot"
        data-treatment-read-state="loading"
      />
    );
  }

  if (treatmentRemoteReadPilot && remote.status === "error") {
    return (
      <Card padding="lg" className="text-center" data-treatment-record-source="remote-pilot">
        <p className="text-[15px] font-medium text-text">無法載入療程紀錄</p>
        <p className="mt-1 text-sm text-secondary-text">
          請稍後再試。
        </p>
      </Card>
    );
  }

  if (treatments.length === 0) {
    return (
      <Card
        padding="lg"
        className="text-center"
        data-treatment-record-source={treatmentRemoteReadPilot ? "remote-pilot" : "local"}
      >
        <p className="text-[15px] font-medium text-text">尚無療程紀錄</p>
        {treatmentHref ? (
          <Link href={treatmentHref} className="mt-3 inline-flex min-h-11 items-center text-sm font-medium text-primary">
            開始第一次療程
          </Link>
        ) : null}
      </Card>
    );
  }

  return (
    <div
      className="space-y-3"
      data-treatment-record-source={treatmentRemoteReadPilot ? "remote-pilot" : "local"}
    >
      {treatments.map((t) => (
        <TreatmentHistoryCard
          key={t.id}
          treatment={t}
          organizationId={organization.id}
          catalog={catalog}
        />
      ))}
    </div>
  );
}

function TreatmentHistoryCard({
  treatment: t,
  organizationId,
  catalog,
}: {
  treatment: TreatmentDraft;
  organizationId: string;
  catalog?: Service[] | null;
}) {
  const service =
    catalog?.find((item) => item.id === t.serviceId) ??
    getServiceById(t.serviceId, organizationId);
  const serviceName = resolveCanonicalServiceDisplayName({
    serviceId: t.serviceId,
    catalogName: service?.name,
  });
  const staffName = resolveCanonicalStaffDisplayName({
    staffId: t.staffId,
    rosterName: getMembership(organizationId, t.staffId)?.displayName,
  });
  const statusLabel = t.status === "completed" ? "已完成" : "進行中";

  return (
    <Link href={`/staff/treatments/${t.id}`} className="block">
      <Card padding="lg" className="transition-colors hover:border-primary/30">
        <div className="flex items-start justify-between gap-3">
          <p className="text-sm text-secondary-text">{formatDate(t.updatedAt)}</p>
          <p className="text-xs text-secondary-text">{statusLabel}</p>
        </div>
        <h3 className="mt-1 text-base font-semibold text-text">{serviceName}</h3>
        <dl className="mt-3 grid gap-2 text-[15px] sm:grid-cols-2">
          <div>
            <dt className="text-sm text-secondary-text">美容師</dt>
            <dd className="text-text">{staffName}</dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">操作</dt>
            <dd className="text-text">{t.operations.join("、") || "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">使用產品</dt>
            <dd className="text-text">{t.products.join("、") || "—"}</dd>
          </div>
          <div>
            <dt className="text-sm text-secondary-text">重點部位</dt>
            <dd className="text-text">
              {t.suggestedTrackingAreas.join("、") ||
                t.followUp.tags.join("、") ||
                "—"}
            </dd>
          </div>
        </dl>
        <p className="mt-3 line-clamp-2 text-[15px] leading-relaxed text-text">
          {t.professionalNote || "尚無專業摘要"}
        </p>
        {t.followUp.note || t.followUp.tags.length > 0 ? (
          <p className="mt-2 text-sm text-secondary-text">
            Follow up：{t.followUp.note || t.followUp.tags.join("、")}
          </p>
        ) : null}
        <p className="mt-3 text-sm font-medium text-primary">查看完整紀錄</p>
      </Card>
    </Link>
  );
}
