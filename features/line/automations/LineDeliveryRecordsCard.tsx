"use client";

import { useEffect, useRef, useState } from "react";
import { Card } from "@/components/ui/Card";
import {
  LINE_DELIVERY_RECORDS_CONFIRM_LABEL,
  LINE_DELIVERY_RECORDS_CREATED_LABEL,
  LINE_DELIVERY_RECORDS_EMPTY,
  LINE_DELIVERY_RECORDS_ERROR_LABEL,
  LINE_DELIVERY_RECORDS_HINT,
  LINE_DELIVERY_RECORDS_KIND_LABEL,
  LINE_DELIVERY_RECORDS_MOCK_LABEL,
  LINE_DELIVERY_RECORDS_STATUS_LABEL,
  LINE_DELIVERY_RECORDS_TITLE,
} from "@/lib/line/automations/copy";
import { shouldApplyLineAutomationClientResult } from "@/lib/line/automations/rules";
import { loadLineDeliveryRecordsAction } from "@/lib/line/delivery/delivery-actions";
import {
  lineDeliveryConfirmationLabel,
  lineDeliveryKindLabel,
  lineDeliveryMockAcceptedLabel,
  lineDeliveryStatusLabel,
  type LineDeliveryRecord,
} from "@/lib/line/delivery/delivery-records";

function formatCreatedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" });
}

export function LineDeliveryRecordsCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const [records, setRecords] = useState<LineDeliveryRecord[]>([]);
  const [message, setMessage] = useState("");
  const activeOrganizationId = useRef(organizationId);
  activeOrganizationId.current = organizationId;

  useEffect(() => {
    const requestOrganizationId = organizationId;
    let cancelled = false;
    setRecords([]);
    setMessage("");
    void loadLineDeliveryRecordsAction(requestOrganizationId).then((result) => {
      if (cancelled) return;
      if (
        !shouldApplyLineAutomationClientResult({
          requestOrganizationId,
          activeOrganizationId: activeOrganizationId.current,
        })
      ) {
        return;
      }
      if (!result.ok || !result.data) {
        setRecords([]);
        setMessage(result.ok ? "" : result.message);
        return;
      }
      setRecords(result.data.records);
    });
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return (
    <Card
      padding="lg"
      data-line-delivery-records
      data-line-delivery-sent="false"
    >
      <h2 className="text-[16px] font-semibold text-text">{LINE_DELIVERY_RECORDS_TITLE}</h2>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">
        {LINE_DELIVERY_RECORDS_HINT}
      </p>
      {message ? <p className="mt-2 text-[13px] text-secondary-text">{message}</p> : null}
      {records.length === 0 ? (
        <p className="mt-3 text-[14px] leading-relaxed text-secondary-text">
          {LINE_DELIVERY_RECORDS_EMPTY}
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {records.map((record) => (
            <li
              key={record.id}
              data-line-delivery-record={record.id}
              data-line-delivery-status={record.status}
              data-line-delivery-mock-accepted={record.mockAccepted ? "true" : "false"}
              data-line-delivery-needs-confirmation={
                record.needsHumanConfirmation ? "true" : "false"
              }
              className="rounded-2xl bg-[#FFFCFB] px-4 py-3 text-[13px]"
            >
              <dl className="grid gap-1 sm:grid-cols-2">
                <div>
                  <dt className="text-secondary-text">{LINE_DELIVERY_RECORDS_KIND_LABEL}</dt>
                  <dd className="font-medium text-text">{lineDeliveryKindLabel(record.kind)}</dd>
                </div>
                <div>
                  <dt className="text-secondary-text">{LINE_DELIVERY_RECORDS_CREATED_LABEL}</dt>
                  <dd className="font-medium text-text">{formatCreatedAt(record.createdAt)}</dd>
                </div>
                <div>
                  <dt className="text-secondary-text">{LINE_DELIVERY_RECORDS_STATUS_LABEL}</dt>
                  <dd className="font-medium text-text">{lineDeliveryStatusLabel(record.status)}</dd>
                </div>
                <div>
                  <dt className="text-secondary-text">{LINE_DELIVERY_RECORDS_MOCK_LABEL}</dt>
                  <dd className="font-medium text-text">
                    {lineDeliveryMockAcceptedLabel(record.mockAccepted)}
                  </dd>
                </div>
                <div>
                  <dt className="text-secondary-text">{LINE_DELIVERY_RECORDS_CONFIRM_LABEL}</dt>
                  <dd className="font-medium text-text">
                    {lineDeliveryConfirmationLabel(record.needsHumanConfirmation)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-secondary-text">{LINE_DELIVERY_RECORDS_ERROR_LABEL}</dt>
                  <dd className="font-medium text-text">{record.lastError ?? "—"}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
