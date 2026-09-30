/**
 * Post-treatment CompleteStep / Checkout presentation helpers.
 * Eligibility is always listUsablePackagesForService(customerId, serviceId).
 * Remaining sessions are derived — never persisted, never CRM residue.
 */

import type { CustomerPackage } from "@/lib/packages/domain";
import { formatTwd } from "@/lib/commerce/money";
import type { CheckoutDraft, CheckoutItem } from "@/lib/commerce/domain";

export const POST_TREATMENT_REDEMPTION_SESSIONS = 1 as const;

export const PACKAGE_ELIGIBILITY_ERROR_MESSAGE =
  "目前無法取得套票資料，請重新整理後再試。";

export interface PostTreatmentPackageCard {
  customerPackageId: string;
  nameSnapshot: string;
  usableBalance: number;
  sessionCountSnapshot: number;
  remainingAfterUse: number;
  includedServiceIdsSnapshot: string[];
}

export type EligiblePackagesLoad =
  | { status: "loading" }
  | { status: "ok"; packages: PostTreatmentPackageCard[] }
  | { status: "error"; message: string };

export interface PackageRedemptionSummaryView {
  serviceName: string;
  originalPriceMinor: number;
  originalPriceLabel: string;
  packageDiscountMinor: number;
  packageDiscountLabel: string;
  dueMinor: number;
  dueLabel: string;
  packageName: string;
  sessionsUsed: typeof POST_TREATMENT_REDEMPTION_SESSIONS;
  currentRemaining: number;
  remainingAfterSettle: number;
}

export function remainingAfterRedemption(usableBalance: number): number {
  return Math.max(0, usableBalance - POST_TREATMENT_REDEMPTION_SESSIONS);
}

export function toPostTreatmentPackageCard(
  pkg: CustomerPackage & { usableBalance: number },
): PostTreatmentPackageCard {
  return {
    customerPackageId: pkg.id,
    nameSnapshot: pkg.nameSnapshot,
    usableBalance: pkg.usableBalance,
    sessionCountSnapshot: pkg.sessionCountSnapshot,
    remainingAfterUse: remainingAfterRedemption(pkg.usableBalance),
    includedServiceIdsSnapshot: pkg.includedServiceIdsSnapshot,
  };
}

export function buildPostTreatmentCheckoutHref(input: {
  appointmentId: string;
  treatmentId?: string;
  customerPackageId?: string;
}): string {
  const params = new URLSearchParams({ appointment: input.appointmentId });
  if (input.treatmentId) params.set("treatment", input.treatmentId);
  if (input.customerPackageId) params.set("package", input.customerPackageId);
  return `/staff/checkout?${params.toString()}`;
}

export function buildNextAppointmentHref(input: {
  customerId: string;
  serviceId: string;
  staffId: string;
}): string {
  const params = new URLSearchParams({
    create: "1",
    customer: input.customerId,
    service: input.serviceId,
    staff: input.staffId,
  });
  return `/staff/calendar?${params.toString()}`;
}

export function primaryServiceLine(
  draft: CheckoutDraft | null | undefined,
): CheckoutItem | undefined {
  return draft?.items.find((item) => item.type === "SERVICE");
}

export function buildPackageRedemptionSummary(input: {
  draft: CheckoutDraft;
  serviceName: string;
  packageName: string;
  currentRemaining: number;
}): PackageRedemptionSummaryView | null {
  if (!input.draft.packageRedemption) return null;
  const service = primaryServiceLine(input.draft);
  const originalPriceMinor = service?.lineSubtotal ?? 0;
  const packageDiscountMinor = service?.discountAmount ?? 0;
  return {
    serviceName: input.serviceName,
    originalPriceMinor,
    originalPriceLabel: formatTwd(originalPriceMinor),
    packageDiscountMinor,
    packageDiscountLabel: `-${formatTwd(packageDiscountMinor)}`,
    dueMinor: input.draft.total,
    dueLabel: formatTwd(input.draft.total),
    packageName: input.packageName,
    sessionsUsed: POST_TREATMENT_REDEMPTION_SESSIONS,
    currentRemaining: input.currentRemaining,
    remainingAfterSettle: remainingAfterRedemption(input.currentRemaining),
  };
}
