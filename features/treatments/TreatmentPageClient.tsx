"use client";

import { useMemo, useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";
import { ComingSoon } from "@/components/ui/ComingSoon";
import { TreatmentWorkspace } from "@/features/treatments/TreatmentWorkspace";
import { getCustomerById } from "@/data";
import {
  findAppointmentForCustomer,
  getAppointmentById,
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

export function TreatmentPageClient() {
  const searchParams = useSearchParams();
  const { organization } = useOrganization();
  const customerId = searchParams.get("customer") ?? "";
  const appointmentId = searchParams.get("appointment");
  useSyncExternalStore(subscribeAppointments, getAppointmentStatusRaw, () => "");

  const customer = customerId
    ? getCustomerById(customerId, organization.id)
    : undefined;

  const appointment = useMemo(() => {
    if (!customerId) return undefined;
    if (appointmentId) {
      return getAppointmentById(appointmentId, organization.id);
    }
    return findAppointmentForCustomer(customerId, organization.id);
  }, [appointmentId, customerId, organization.id]);

  if (!customerId) {
    return <ComingSoon title="找不到客戶" description="請從今日工作台重新進入。" />;
  }

  if (!customer) {
    return (
      <ComingSoon
        title="找不到客戶"
        description="Access unavailable — 此客戶不屬於目前店家，或資料不存在。"
      />
    );
  }

  if (!appointment) {
    return (
      <ComingSoon title="找不到預約" description="請從今日工作台選擇預約後開始服務。" />
    );
  }

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

  return <TreatmentWorkspace customer={customer} appointment={appointment} />;
}
