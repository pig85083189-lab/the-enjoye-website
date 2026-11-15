/**
 * Choose the stored-value customer for a booking customer.
 * A confirmed identity link is explicit. Name and phone are never inputs.
 */

export type StoredValueIdentityLink = {
  walletCustomerId: string;
  walletActive: boolean;
  walletLineBound: boolean;
};

export type StoredValueWalletDecision =
  | { ok: true; walletCustomerId: string; via: "self" | "confirmed_link" }
  | { ok: false; code: "LINE_LINK_REQUIRED" | "WALLET_CUSTOMER_UNAVAILABLE" };

export type CrossDbIdentitySignals = {
  appIdEqual: boolean;
  lineHashEqual: boolean;
  sharedAppointmentCount: number;
  nameEqual: boolean;
  phoneEqual: boolean;
};

/** Name and phone are recorded for the operator only. They never confirm a link. */
export function crossDbIdentityEvidence(
  signals: CrossDbIdentitySignals,
): "app_id" | "line_hash" | "shared_appointment" | null {
  if (signals.appIdEqual) return "app_id";
  if (signals.lineHashEqual) return "line_hash";
  if (signals.sharedAppointmentCount > 0) return "shared_appointment";
  return null;
}

/** PostgREST/Postgres codes for a relation that has not been created yet. */
export function identityRelationIsMissing(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
}

const CUSTOMER_DB_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function checkoutCustomerKeyIsDbId(customerKey: string): boolean {
  return CUSTOMER_DB_ID.test(customerKey.trim());
}

export type CheckoutCustomerRow = {
  id: string;
  appId: string | null;
  status: string;
};

/**
 * Checkout sends the operational customer key. A customer with a blank app_id
 * is published as customers.id. Match that key to one ACTIVE row in the
 * organization that was already queried. An app_id hit is never replaced by
 * a different row's id.
 */
export function chooseCheckoutCustomer<T extends CheckoutCustomerRow>(input: {
  checkoutCustomerKey: string;
  appIdMatches: readonly T[];
  idMatches: readonly T[];
}): T | null {
  const key = input.checkoutCustomerKey.trim();
  if (!key) return null;
  const appHits = input.appIdMatches.filter(
    (row) => row.status === "ACTIVE" && (row.appId ?? "").trim() === key,
  );
  if (input.appIdMatches.length > 0) return appHits.length === 1 ? appHits[0] : null;
  if (!checkoutCustomerKeyIsDbId(key)) return null;
  const idHits = input.idMatches.filter((row) => row.status === "ACTIVE" && row.id === key);
  return idHits.length === 1 ? idHits[0] : null;
}

export function resolveStoredValueWalletCustomer(input: {
  bookingCustomerId: string;
  bookingLineBound: boolean;
  link: StoredValueIdentityLink | null;
}): StoredValueWalletDecision {
  if (input.link) {
    if (input.link.walletCustomerId === input.bookingCustomerId) {
      return { ok: false, code: "WALLET_CUSTOMER_UNAVAILABLE" };
    }
    if (!input.link.walletActive) return { ok: false, code: "WALLET_CUSTOMER_UNAVAILABLE" };
    if (!input.link.walletLineBound) return { ok: false, code: "LINE_LINK_REQUIRED" };
    return { ok: true, walletCustomerId: input.link.walletCustomerId, via: "confirmed_link" };
  }
  if (!input.bookingLineBound) return { ok: false, code: "LINE_LINK_REQUIRED" };
  return { ok: true, walletCustomerId: input.bookingCustomerId, via: "self" };
}
