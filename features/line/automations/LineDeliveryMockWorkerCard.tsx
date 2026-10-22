"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  LINE_DELIVERY_WORKER_BADGE,
  LINE_DELIVERY_WORKER_DONE,
  LINE_DELIVERY_WORKER_HINT,
  LINE_DELIVERY_WORKER_NO_WORK,
  LINE_DELIVERY_WORKER_NOT_SENT,
  LINE_DELIVERY_WORKER_RUN,
  LINE_DELIVERY_WORKER_TITLE,
} from "@/lib/line/automations/copy";
import { shouldApplyLineAutomationClientResult } from "@/lib/line/automations/rules";
import { runLineDeliveryMockWorkerAction } from "@/lib/line/delivery/delivery-actions";

export function LineDeliveryMockWorkerCard({
  organizationId,
}: {
  organizationId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const activeOrganizationId = useRef(organizationId);
  activeOrganizationId.current = organizationId;

  async function runWorker() {
    const requestOrganizationId = organizationId;
    setBusy(true);
    setMessage("");
    const result = await runLineDeliveryMockWorkerAction(requestOrganizationId);
    if (
      !shouldApplyLineAutomationClientResult({
        requestOrganizationId,
        activeOrganizationId: activeOrganizationId.current,
      })
    ) {
      setBusy(false);
      return;
    }
    setBusy(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    setMessage(
      result.data?.noWork ? LINE_DELIVERY_WORKER_NO_WORK : LINE_DELIVERY_WORKER_DONE,
    );
  }

  return (
    <Card
      padding="lg"
      data-line-delivery-mock-worker
      data-line-delivery-sent="false"
      data-line-delivery-worker-open="false"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-text">{LINE_DELIVERY_WORKER_TITLE}</h2>
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-medium text-primary">
          {LINE_DELIVERY_WORKER_BADGE}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">
        {LINE_DELIVERY_WORKER_HINT}
      </p>
      <p className="mt-1 text-[13px] font-medium text-text">{LINE_DELIVERY_WORKER_NOT_SENT}</p>
      <Button
        className="mt-4"
        variant="secondary"
        disabled={busy}
        data-line-delivery-worker-run="true"
        onClick={() => {
          void runWorker();
        }}
      >
        {LINE_DELIVERY_WORKER_RUN}
      </Button>
      {message ? <p className="mt-3 text-[13px] text-secondary-text">{message}</p> : null}
    </Card>
  );
}
