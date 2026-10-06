/**
 * Read-only derived tender presentation.
 * PACKAGE is a redemption label — never a canonical payment-method write.
 * Identity: packageRedemption.customerPackageId / serviceId only.
 */
import {
  ACTIVE_PAYMENT_METHODS,
  EXTERNAL_PAYMENT_METHODS,
  PAYMENT_METHOD_LABEL,
  type PackageRedemptionSelection,
  type PaymentMethod,
  type Transaction,
  type TransactionItemSnapshot,
  type TransactionPaymentSnapshot,
} from "@/lib/commerce/domain";
import { formatTwd } from "@/lib/commerce/money";

export const TENDER_PACKAGE_IS_PAYMENT_METHOD = false;
export const STORED_VALUE_WRITE_OPEN = false;

export type PackageNameHint = {
  id: string;
  nameSnapshot: string;
};

export type TenderKind =
  | "CASH"
  | "CARD"
  | "TRANSFER"
  | "OTHER"
  | "STORED_VALUE"
  | "PACKAGE"
  | "MIXED"
  | "NONE";

export type TenderLineKind =
  | "CASH"
  | "CARD"
  | "TRANSFER"
  | "OTHER"
  | "STORED_VALUE"
  | "PACKAGE";

export type TransactionTenderLine = {
  kind: TenderLineKind;
  label: string;
  amountMinor: number;
  sessions?: number;
  customerPackageId?: string;
  packageName?: string | null;
};

export type PackageRedemptionPresentation = {
  customerPackageId: string;
  serviceId: string;
  sessions: number;
  packageName: string | null;
  redeemedValueMinor: number;
};

export type TransactionTenderPresentation = {
  serviceValueMinor: number;
  collectedMinor: number;
  storedValueMinor: number;
  packageRedemption: PackageRedemptionPresentation | null;
  tenderLines: TransactionTenderLine[];
  tenderKind: TenderKind;
  tenderBadge: string;
  paymentMethods: PaymentMethod[];
};

export function isCanonicalPaymentMethod(method: string): method is PaymentMethod {
  return (
    method === "CASH" ||
    method === "CARD" ||
    method === "TRANSFER" ||
    method === "OTHER" ||
    method === "STORED_VALUE" ||
    method === "PACKAGE"
  );
}

export function isActiveCheckoutPaymentMethod(method: PaymentMethod): boolean {
  return (ACTIVE_PAYMENT_METHODS as readonly PaymentMethod[]).includes(method);
}

export function packageNameFromCatalog(
  customerPackageId: string,
  catalog: PackageNameHint[] | undefined,
): string | null {
  const name = catalog
    ?.find((row) => row.id === customerPackageId)
    ?.nameSnapshot.trim();
  return name ? name : null;
}

export function serviceValueMinor(transaction: Transaction): number {
  const services = transaction.items.filter((item) => item.type === "SERVICE");
  if (services.length > 0) {
    return services.reduce((sum, item) => sum + serviceLineValueMinor(item), 0);
  }
  return transaction.subtotal;
}

function serviceLineValueMinor(item: TransactionItemSnapshot): number {
  if (item.lineSubtotal > 0) return item.lineSubtotal;
  return item.unitPrice * item.quantity;
}

export function collectedMinor(transaction: Transaction): number {
  if (transaction.status !== "COMPLETED") return 0;
  return transaction.payments
    .filter((payment) =>
      (EXTERNAL_PAYMENT_METHODS as readonly PaymentMethod[]).includes(payment.method),
    )
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function storedValueTenderAmountMinor(
  payments: TransactionPaymentSnapshot[],
): number {
  return payments
    .filter((payment) => payment.method === "STORED_VALUE")
    .reduce((sum, payment) => sum + payment.amount, 0);
}

export function packageRedeemedValueMinor(transaction: Transaction): number {
  if (!transaction.packageRedemption) return 0;
  return transaction.items
    .filter((item) => item.type === "SERVICE")
    .reduce((sum, item) => sum + item.discountAmount, 0);
}

export function packageTenderLabel(input: {
  packageName: string | null;
  sessions: number;
}): string {
  const sessions = `${input.sessions}堂`;
  return input.packageName
    ? `套票 · ${input.packageName} · ${sessions}`
    : `套票 · ${sessions}`;
}

function uniquePaymentMethods(
  payments: TransactionPaymentSnapshot[],
): PaymentMethod[] {
  const seen: PaymentMethod[] = [];
  for (const payment of payments) {
    if (!seen.includes(payment.method)) seen.push(payment.method);
  }
  return seen;
}

export function presentTransactionTender(
  transaction: Transaction,
  catalog?: PackageNameHint[],
): TransactionTenderPresentation {
  const paymentMethods = uniquePaymentMethods(transaction.payments);
  const collected = collectedMinor(transaction);
  const stored = storedValueTenderAmountMinor(transaction.payments);
  const redemption = transaction.packageRedemption
    ? presentPackageRedemption(transaction, catalog)
    : null;

  const tenderLines: TransactionTenderLine[] = [];
  if (redemption) {
    tenderLines.push({
      kind: "PACKAGE",
      label: packageTenderLabel(redemption),
      amountMinor: redemption.redeemedValueMinor,
      sessions: redemption.sessions,
      customerPackageId: redemption.customerPackageId,
      packageName: redemption.packageName,
    });
  }
  for (const payment of transaction.payments) {
    if (payment.method === "PACKAGE") continue;
    tenderLines.push({
      kind: payment.method,
      label: PAYMENT_METHOD_LABEL[payment.method],
      amountMinor: payment.amount,
    });
  }

  const moneyKinds = paymentMethods.filter((method) => method !== "PACKAGE");
  let tenderKind: TenderKind = "NONE";
  if (redemption && moneyKinds.length > 0) tenderKind = "MIXED";
  else if (redemption) tenderKind = "PACKAGE";
  else if (moneyKinds.length > 1) tenderKind = "MIXED";
  else if (moneyKinds[0] === "CASH") tenderKind = "CASH";
  else if (moneyKinds[0] === "CARD") tenderKind = "CARD";
  else if (moneyKinds[0] === "TRANSFER") tenderKind = "TRANSFER";
  else if (moneyKinds[0] === "OTHER") tenderKind = "OTHER";
  else if (moneyKinds[0] === "STORED_VALUE") tenderKind = "STORED_VALUE";

  return {
    serviceValueMinor: serviceValueMinor(transaction),
    collectedMinor: collected,
    storedValueMinor: stored,
    packageRedemption: redemption,
    tenderLines,
    tenderKind,
    tenderBadge: tenderBadgeFor(tenderKind, redemption, moneyKinds),
    paymentMethods,
  };
}

function presentPackageRedemption(
  transaction: Transaction,
  catalog?: PackageNameHint[],
): PackageRedemptionPresentation | null {
  const selection = transaction.packageRedemption;
  if (!selection?.customerPackageId || !selection.serviceId) return null;
  return {
    customerPackageId: selection.customerPackageId,
    serviceId: selection.serviceId,
    sessions: selection.sessions,
    packageName: packageNameFromCatalog(selection.customerPackageId, catalog),
    redeemedValueMinor: packageRedeemedValueMinor(transaction),
  };
}

function tenderBadgeFor(
  kind: TenderKind,
  redemption: PackageRedemptionPresentation | null,
  moneyKinds: PaymentMethod[],
): string {
  if (kind === "PACKAGE" && redemption) return packageTenderLabel(redemption);
  if (kind === "MIXED") return "混合付款";
  if (kind === "NONE") return redemption ? packageTenderLabel(redemption) : "無需付款";
  return PAYMENT_METHOD_LABEL[moneyKinds[0] ?? "CASH"];
}

export function checkoutConfirmCtaLabel(input: {
  packageRedemption?: PackageRedemptionSelection | null;
  dueMinor: number;
}): string {
  if (input.packageRedemption && input.dueMinor === 0) {
    return `確認使用 ${input.packageRedemption.sessions} 堂並完成結帳`;
  }
  if (input.packageRedemption) {
    return `完成結帳 ${formatTwd(input.dueMinor)}`;
  }
  return `確認收款 ${formatTwd(input.dueMinor)}`;
}

export function checkoutPackageDueSummary(input: {
  serviceValueMinor: number;
  packageDiscountMinor: number;
  dueMinor: number;
}): {
  serviceValueMinor: number;
  packageDiscountMinor: number;
  dueMinor: number;
} {
  return {
    serviceValueMinor: input.serviceValueMinor,
    packageDiscountMinor: input.packageDiscountMinor,
    dueMinor: input.dueMinor,
  };
}

export type DailyEntitlementSummary = {
  todayCollectedMinor: number;
  packageSessions: number;
  packageRedeemedMinor: number;
  storedValueMinor: number;
  storedValueWriteOpen: false;
};

export function countDailyEntitlementSummary(
  presentations: Array<{
    completedAt: string;
    status: "COMPLETED" | "VOIDED";
    tender: TransactionTenderPresentation;
  }>,
  now: Date,
  matchesToday: (completedAt: string, now: Date) => boolean,
): DailyEntitlementSummary {
  let todayCollectedMinor = 0;
  let packageSessions = 0;
  let packageRedeemedMinor = 0;
  let storedValueMinor = 0;
  for (const row of presentations) {
    if (row.status !== "COMPLETED" || !matchesToday(row.completedAt, now)) continue;
    todayCollectedMinor += row.tender.collectedMinor;
    if (row.tender.packageRedemption) {
      packageSessions += row.tender.packageRedemption.sessions;
      packageRedeemedMinor += row.tender.packageRedemption.redeemedValueMinor;
    }
    storedValueMinor += row.tender.storedValueMinor;
  }
  return {
    todayCollectedMinor,
    packageSessions,
    packageRedeemedMinor,
    storedValueMinor,
    storedValueWriteOpen: false,
  };
}
