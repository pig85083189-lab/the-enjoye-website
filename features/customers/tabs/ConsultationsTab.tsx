"use client";

import { useState } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { localConsultationRepository } from "@/lib/repositories/local-consultation-repository";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  CONSULTATION_GOAL_LABEL,
  type CustomerConsultation,
} from "@/types/customer";

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

function ConsultationDetail({ item }: { item: CustomerConsultation }) {
  const health = item.healthItems.filter((h) => h.checked);
  return (
    <div className="mt-3 space-y-3 border-t border-border pt-3 text-[15px]">
      <div>
        <p className="text-sm text-secondary-text">主要需求</p>
        <p className="mt-1 text-text">
          {item.goals.map((g) => CONSULTATION_GOAL_LABEL[g]).join("、") || "—"}
        </p>
        {item.goalNote ? <p className="mt-1 text-secondary-text">{item.goalNote}</p> : null}
      </div>
      {health.length > 0 ? (
        <div>
          <p className="text-sm text-secondary-text">重要身體狀況</p>
          <ul className="mt-1 space-y-1">
            {health.map((h) => (
              <li key={h.id} className="text-text">
                {h.label}
                {h.note ? `：${h.note}` : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {item.signatureText ? (
        <p className="text-sm text-secondary-text">簽名：{item.signatureText}</p>
      ) : null}
    </div>
  );
}

interface ConsultationsTabProps {
  customerId: string;
}

export function ConsultationsTab({ customerId }: ConsultationsTabProps) {
  const { organization } = useOrganization();
  const items = localConsultationRepository.listByCustomer({
    organizationId: organization.id,
    customerId,
  });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Link href={`/staff/customers/${customerId}/consultation/new`}>
          <Button variant="secondary" className="min-h-11">
            新增諮詢更新
          </Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <Card padding="lg">
          <p className="text-[15px] text-secondary-text">尚無諮詢紀錄</p>
          <Link
            href={`/staff/customers/${customerId}/consultation/new`}
            className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary"
          >
            填寫電子諮詢表
          </Link>
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.id} padding="lg">
            <p className="text-sm text-secondary-text">{formatDate(item.consultedAt)}</p>
            <h3 className="mt-1 text-base font-semibold text-text">{item.title}</h3>
            <p className="mt-2 text-[15px] text-text">
              協助美容師：{item.consultedByName}
            </p>
            <button
              type="button"
              className="mt-2 min-h-11 text-sm font-medium text-primary"
              onClick={() => setOpenId(openId === item.id ? null : item.id)}
            >
              {openId === item.id ? "收合" : "查看完整內容"}
            </button>
            {openId === item.id ? <ConsultationDetail item={item} /> : null}
          </Card>
        ))
      )}
    </div>
  );
}
