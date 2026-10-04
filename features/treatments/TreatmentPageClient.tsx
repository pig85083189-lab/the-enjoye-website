"use client";

import { useSyncExternalStore } from "react";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { TreatmentWorkspace } from "@/features/treatments/TreatmentWorkspace";
import { useTreatmentAppointmentIdentity } from "@/features/treatments/use-treatment-appointment-identity";
import { useTreatmentCustomerIdentity } from "@/features/treatments/use-treatment-customer-identity";
import {
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { useSearchParams } from "next/navigation";

export function TreatmentPageClient({
  customerRemoteReadPilot = false,
  appointmentRemoteReadPilot = false,
}: {
  customerRemoteReadPilot?: boolean;
  appointmentRemoteReadPilot?: boolean;
}) {
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const customerId = searchParams.get("customer") ?? "";
  const appointmentId = searchParams.get("appointment");
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");
  const customerIdentity = useTreatmentCustomerIdentity({
    organizationId: organization.id,
    customerId,
    customerRemoteReadPilot,
  });
  const appointmentIdentity = useTreatmentAppointmentIdentity({
    organizationId: organization.id,
    customerId,
    appointmentId,
    appointmentRemoteReadPilot,
  });

  if (customerIdentity.status === "missing-id") {
    return <ComingSoon title="找不到客戶" description="請從今日工作台重新進入。" />;
  }

  if (customerIdentity.status === "loading") {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center text-secondary-text"
        data-customer-identity-source="remote-pilot"
        data-customer-read-state="loading"
      >
        載入客戶資料…
      </div>
    );
  }

  if (customerIdentity.status === "error") {
    return (
      <ComingSoon
        title="找不到客戶"
        description="Access unavailable — remote customer read failed. 不會改用本機示範資料。"
      />
    );
  }

  if (customerIdentity.status === "empty") {
    return (
      <ComingSoon
        title="找不到客戶"
        description="Access unavailable — 此客戶不屬於目前店家，或資料不存在。"
      />
    );
  }

  const customer = customerIdentity.customer;

  if (appointmentIdentity.status === "loading") {
    return (
      <div
        className="flex min-h-[40vh] items-center justify-center text-secondary-text"
        data-customer-identity-source={customerIdentity.source === "remote" ? "remote-pilot" : "local"}
      >
        載入預約資料…
      </div>
    );
  }

  if (appointmentIdentity.status === "error") {
    return (
      <ComingSoon
        title="找不到預約"
        description="Access unavailable — remote appointment read failed. 不會改用本機示範資料。"
      />
    );
  }

  if (appointmentIdentity.status === "empty") {
    return (
      <ComingSoon title="找不到預約" description="請從今日工作台選擇預約後開始服務。" />
    );
  }

  const appointment = appointmentIdentity.appointment;

  if (appointment.organizationId !== organization.id) {
    return (
      <ComingSoon
        title="找不到預約"
        description="Access unavailable — 此預約不屬於目前店家。"
      />
    );
  }

  if (appointment.customerId !== customer.id) {
    return <ComingSoon title="預約資料不符" description="請重新選擇正確的客戶與預約。" />;
  }

  return (
    <div
      data-customer-identity-source={
        customerIdentity.source === "remote" ? "remote-pilot" : "local"
      }
      data-treatment-record-source="local"
    >
      <TreatmentWorkspace customer={customer} appointment={appointment} />
    </div>
  );
}
