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

/** PostgREST/Postgres codes for a relation that has not been created yet. */
export function identityRelationIsMissing(code: string | undefined): boolean {
  return code === "PGRST205" || code === "42P01";
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
