/**
 * Booking-database customer key to the finance-database booking customer.
 * The link is an explicit managerial record. Name and phone are never inputs.
 */

export const BOOKING_SOURCE_EVIDENCE = ["CUSTOMER_PRESENT", "TRUSTED_MEMBER_RECORD"] as const;

export type BookingSourceEvidence = (typeof BOOKING_SOURCE_EVIDENCE)[number];

export type BookingSourceLinkRow = {
  organizationId: string;
  sourceCustomerKey: string;
  financeBookingCustomerId: string;
  status: string;
  evidenceKind: string;
};

export function isBookingSourceEvidence(value: string): value is BookingSourceEvidence {
  return (BOOKING_SOURCE_EVIDENCE as readonly string[]).includes(value);
}

/**
 * One ACTIVE link in the caller's organization. A second row, a revoked row,
 * or a row from another organization does not resolve.
 */
export function resolveBookingSourceFinanceCustomer(input: {
  organizationId: string;
  sourceCustomerKey: string;
  links: readonly BookingSourceLinkRow[];
}): string | null {
  const key = input.sourceCustomerKey.trim();
  const organizationId = input.organizationId.trim();
  if (!key || !organizationId) return null;
  const hits = input.links.filter(
    (row) =>
      row.status === "ACTIVE" &&
      row.organizationId === organizationId &&
      row.sourceCustomerKey === key &&
      isBookingSourceEvidence(row.evidenceKind) &&
      row.financeBookingCustomerId.trim().length > 0,
  );
  return hits.length === 1 ? hits[0].financeBookingCustomerId : null;
}
