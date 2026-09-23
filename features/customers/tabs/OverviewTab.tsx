"use client";

import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { getServiceById } from "@/data/mock-services";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  CHAT_PREF_LABEL,
  PRESSURE_LABEL,
  TEMPERATURE_LABEL,
} from "@/types/customer";
import type { Customer } from "@/types";

function formatDate(isoOrSlash: string): string {
  if (!isoOrSlash) return "—";
  if (isoOrSlash.includes("T")) {
    const d = new Date(isoOrSlash);
    if (Number.isNaN(d.getTime())) return isoOrSlash;
    return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  }
  return isoOrSlash;
}

interface OverviewTabProps {
  customer: Customer;
  onOpenTreatments: () => void;
}

export function OverviewTab({ customer, onOpenTreatments }: OverviewTabProps) {
  const { organization } = useOrganization();
  const treatments = localTreatmentRepository.listByCustomer({
    organizationId: organization.id,
    customerId: customer.id,
  });
  const latest = treatments[0];
  const recent = treatments.slice(0, 3);
  const prefs = customer.preferences;
  const serviceName = latest
    ? getServiceById(latest.serviceId, organization.id)?.name ?? "療程"
    : null;

  return (
    <div className="space-y-4">
      <Card padding="lg">
        <h3 className="text-base font-semibold text-text">最近一次服務</h3>
        {latest ? (
          <div className="mt-3 space-y-2 text-[15px]">
            <p className="text-secondary-text">{formatDate(latest.updatedAt)}</p>
            <p className="font-medium text-text">{serviceName}</p>
            <p className="text-text">
              美容師：{customer.primaryStaffName ?? "—"}
            </p>
            <p className="leading-relaxed text-text">
              {latest.professionalNote || "尚無專業摘要"}
            </p>
            <Link
              href={`/staff/treatments/${latest.id}`}
              className="inline-flex min-h-11 items-center text-sm font-medium text-primary"
            >
              查看完整紀錄
            </Link>
          </div>
        ) : (
          <p className="mt-3 text-[15px] text-secondary-text">尚無療程紀錄</p>
        )}
      </Card>

      <Card padding="lg">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-base font-semibold text-text">近期追蹤</h3>
          {customer.updatedAt ? (
            <span className="text-xs text-secondary-text">
              更新於 {formatDate(customer.updatedAt)}
            </span>
          ) : null}
        </div>
        {customer.trackingFocus.length > 0 ? (
          <ul className="mt-3 space-y-2">
            {customer.trackingFocus.map((item) => (
              <li key={item} className="text-[15px] text-text">
                {item}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-[15px] text-secondary-text">尚無追蹤項目</p>
        )}
      </Card>

      <Card padding="lg">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-text">近期療程</h3>
          <button
            type="button"
            onClick={onOpenTreatments}
            className="min-h-11 text-sm font-medium text-primary"
          >
            查看更多
          </button>
        </div>
        {recent.length > 0 ? (
          <ol className="mt-3 space-y-3 border-l border-border pl-4">
            {recent.map((t) => (
              <li key={t.id}>
                <Link href={`/staff/treatments/${t.id}`} className="block min-h-11 py-1">
                  <p className="text-sm text-secondary-text">{formatDate(t.updatedAt)}</p>
                  <p className="font-medium text-text">
                    {getServiceById(t.serviceId, organization.id)?.name ?? "療程"}
                  </p>
                  <p className="line-clamp-1 text-sm text-secondary-text">
                    {t.professionalNote || t.followUp.tags.join("、") || "—"}
                  </p>
                </Link>
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-3 text-[15px] text-secondary-text">尚無療程紀錄</p>
        )}
      </Card>

      <Card padding="lg">
        <h3 className="text-base font-semibold text-text">客戶偏好</h3>
        {prefs &&
        (prefs.preferredStaffName ||
          prefs.pressure ||
          prefs.chatPreference ||
          prefs.temperature ||
          prefs.scentPreference ||
          prefs.sensitiveProducts) ? (
          <dl className="mt-3 grid gap-3 sm:grid-cols-2">
            {prefs.preferredStaffName ? (
              <div>
                <dt className="text-sm text-secondary-text">偏好美容師</dt>
                <dd className="mt-0.5 text-[15px] text-text">{prefs.preferredStaffName}</dd>
              </div>
            ) : null}
            {prefs.pressure ? (
              <div>
                <dt className="text-sm text-secondary-text">力道</dt>
                <dd className="mt-0.5 text-[15px] text-text">{PRESSURE_LABEL[prefs.pressure]}</dd>
              </div>
            ) : null}
            {prefs.chatPreference ? (
              <div>
                <dt className="text-sm text-secondary-text">聊天偏好</dt>
                <dd className="mt-0.5 text-[15px] text-text">
                  {CHAT_PREF_LABEL[prefs.chatPreference]}
                </dd>
              </div>
            ) : null}
            {prefs.temperature ? (
              <div>
                <dt className="text-sm text-secondary-text">溫度</dt>
                <dd className="mt-0.5 text-[15px] text-text">
                  {TEMPERATURE_LABEL[prefs.temperature]}
                </dd>
              </div>
            ) : null}
            {prefs.scentPreference ? (
              <div>
                <dt className="text-sm text-secondary-text">精油偏好</dt>
                <dd className="mt-0.5 text-[15px] text-text">{prefs.scentPreference}</dd>
              </div>
            ) : null}
            {prefs.sensitiveProducts ? (
              <div>
                <dt className="text-sm text-secondary-text">容易敏感產品</dt>
                <dd className="mt-0.5 text-[15px] text-text">{prefs.sensitiveProducts}</dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="mt-3 text-[15px] text-secondary-text">尚未建立偏好資料</p>
        )}
      </Card>
    </div>
  );
}
