"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { getServiceById } from "@/data/mock-services";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

interface TreatmentsTabProps {
  customerId: string;
}

export function TreatmentsTab({ customerId }: TreatmentsTabProps) {
  const { organization } = useOrganization();
  const treatments = localTreatmentRepository.listByCustomer({
    organizationId: organization.id,
    customerId,
  });

  if (treatments.length === 0) {
    return (
      <Card padding="lg">
        <p className="text-[15px] text-secondary-text">尚無療程紀錄</p>
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      {treatments.map((t) => {
        const service = getServiceById(t.serviceId, organization.id);
        return (
          <Link key={t.id} href={`/staff/treatments/${t.id}`} className="block">
            <Card padding="lg" className="transition-colors hover:border-primary/30">
              <p className="text-sm text-secondary-text">{formatDate(t.updatedAt)}</p>
              <h3 className="mt-1 text-base font-semibold text-text">
                {service?.name ?? "療程"}
              </h3>
              <dl className="mt-3 grid gap-2 text-[15px] sm:grid-cols-2">
                <div>
                  <dt className="text-sm text-secondary-text">美容師</dt>
                  <dd className="text-text">
                    {getMembership(organization.id, t.staffId)?.displayName ?? "—"}
                  </dd>
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
      })}
    </div>
  );
}
