"use client";

import { useMemo, useSyncExternalStore } from "react";
import { getServicesForOrganization } from "@/data/mock-services";
import {
  findAppointmentForCustomer,
  getAppointmentStatusRaw,
  subscribeAppointments,
} from "@/lib/appointment-store";
import { listAppointments } from "@/lib/appointments/store";
import {
  getCommerceRevision,
  subscribeCommerce,
} from "@/lib/commerce/checkout-store";
import { listTransactions } from "@/lib/commerce/transaction-store";
import {
  collectCustomerAttentionNotes,
  deriveNextAppointment,
  type AppointmentHint,
} from "@/lib/customers/crm-derived";
import {
  customerCreateAppointmentHref,
  deriveCustomerTimeline,
  deriveFrequentServices,
  deriveLastVisitLabel,
  derivePackageFinancialCards,
  derivePrimaryServiceName,
  deriveRecentTransactions,
  deriveServiceFocus,
  previewPackages,
  previewTimeline,
  type Customer360ServiceFocus,
  type FrequentServiceView,
  type PackageFinancialView,
  type RecentTransactionView,
  type TimelineItemView,
} from "@/lib/customers/customer-360";
import {
  getFollowUpRevision,
  listFollowUpTasksForCustomer,
  subscribeFollowUps,
} from "@/lib/follow-ups/store";
import {
  getPackageUsableBalance,
  listCustomerPackages,
  listPackageLedger,
} from "@/lib/packages/store";
import { localConsultationRepository } from "@/lib/repositories/local-consultation-repository";
import { localTreatmentRepository } from "@/lib/repositories/local-treatment-repository";
import {
  getCustomerStoredValueBalance,
  listStoredValueLedger,
} from "@/lib/stored-value/store";
import type { ScheduleAppointment } from "@/lib/appointments/domain";
import { getMembership } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  pickRemoteAppointmentForCustomer,
  treatmentWorkspaceEntryHref,
} from "@/lib/treatments/treatment-identity";
import type { Customer } from "@/types";
import type { TreatmentDraft } from "@/types/treatment";

export type Customer360Snapshot = {
  treatmentHref: string;
  createHref: string;
  nextAppointment: ReturnType<typeof deriveNextAppointment>;
  lastVisitLabel: string | null;
  visitCount: number;
  primaryServiceName: string | null;
  attention: string[];
  focus: Customer360ServiceFocus;
  frequent: FrequentServiceView[];
  timeline: TimelineItemView[];
  timelinePreview: TimelineItemView[];
  packageCards: PackageFinancialView[];
  packagePreview: PackageFinancialView[];
  svBalance: number;
  recentTx: RecentTransactionView[];
};

export function useCustomer360Snapshot(
  customer: Customer,
  options?: {
    remoteAppointments?: ScheduleAppointment[] | null;
    remoteTreatments?: TreatmentDraft[] | null;
  },
): Customer360Snapshot {
  const { organization } = useOrganization();
  const appointmentRev = useSyncExternalStore(
    subscribeAppointments,
    getAppointmentStatusRaw,
    () => "",
  );
  const commerceRev = useSyncExternalStore(
    subscribeCommerce,
    getCommerceRevision,
    () => "",
  );
  const followUpRev = useSyncExternalStore(
    subscribeFollowUps,
    getFollowUpRevision,
    () => "",
  );

  const remoteAppointments = options?.remoteAppointments;
  const remoteTreatments = options?.remoteTreatments;

  return useMemo(() => {
    void appointmentRev;
    void commerceRev;
    void followUpRev;
    const organizationId = organization.id;
    const customerId = customer.id;
    const treatments =
      remoteTreatments != null
        ? remoteTreatments
        : localTreatmentRepository.listByCustomer({
            organizationId,
            customerId,
          });
    const appointments = listAppointments({ organizationId, customerId });
    const followUps = listFollowUpTasksForCustomer(organizationId, customerId);
    const consultations = localConsultationRepository.listByCustomer({
      organizationId,
      customerId,
    });
    const transactions = listTransactions(organizationId, { customerId });
    const packages = listCustomerPackages(organizationId, { customerId });
    const packageLedger = listPackageLedger(organizationId, { customerId });
    const svLedger = listStoredValueLedger(organizationId, { customerId });
    const svBalance = getCustomerStoredValueBalance(organizationId, customerId);
    const catalog = getServicesForOrganization(organizationId);
    const staffNameById: Record<string, string> = {};
    for (const treatment of treatments) {
      const name = getMembership(organizationId, treatment.staffId)?.displayName;
      if (name) staffNameById[treatment.staffId] = name;
    }
    if (customer.primaryStaffId && customer.primaryStaffName) {
      staffNameById[customer.primaryStaffId] = customer.primaryStaffName;
    }

    const completedTreatments = treatments.filter(
      (item) => !item.status || item.status === "completed",
    );
    const latestTreatment = completedTreatments[0] ?? null;
    const latestConsultation = consultations[0] ?? null;
    const focus = deriveServiceFocus({
      customer,
      latestTreatment,
      latestConsultation,
    });
    const frequent = deriveFrequentServices({
      treatments,
      appointments,
      catalog,
    });
    const timeline = deriveCustomerTimeline({
      customerId,
      treatments,
      appointments,
      followUps,
      consultations,
      transactions,
      packageLedger,
      storedValueLedger: svLedger,
      catalog,
      staffNameById,
    });
    const packageCards = derivePackageFinancialCards(
      organizationId,
      packages,
      getPackageUsableBalance,
    );
    const hints: AppointmentHint[] = appointments.map((item) => ({
      customerId: item.customerId,
      status: item.status,
      serviceId: item.serviceId,
      serviceName: item.serviceName,
      durationMinutes: item.durationMinutes,
      startAt: item.startAt,
    }));
    const now = new Date();
    const apt =
      remoteAppointments != null
        ? pickRemoteAppointmentForCustomer(remoteAppointments)
        : findAppointmentForCustomer(customerId, organizationId);
    const treatmentHref = treatmentWorkspaceEntryHref({
      customerId,
      appointmentId: apt?.id,
    });

    return {
      treatmentHref,
      createHref: customerCreateAppointmentHref(customerId),
      nextAppointment: deriveNextAppointment({ customer, appointments: hints, now }),
      lastVisitLabel: deriveLastVisitLabel({ customer, appointments, treatments }),
      visitCount: customer.totalVisits,
      primaryServiceName: derivePrimaryServiceName(frequent, customer),
      attention: collectCustomerAttentionNotes(customer, [
        latestTreatment?.professionalNote,
        latestTreatment?.discomfortNote,
      ]),
      focus,
      frequent,
      timeline,
      timelinePreview: previewTimeline(timeline),
      packageCards,
      packagePreview: previewPackages(packageCards),
      svBalance,
      recentTx: deriveRecentTransactions(transactions),
    };
  }, [
    customer,
    organization.id,
    appointmentRev,
    commerceRev,
    followUpRev,
    remoteAppointments,
    remoteTreatments,
  ]);
}
