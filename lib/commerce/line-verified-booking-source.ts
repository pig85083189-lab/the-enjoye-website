/**
 * Decides whether a verified LINE subject may connect a booking customer
 * to the finance customer. Personal attributes are not inputs.
 */

export const LINE_BINDING_REVIEW_REASONS = [
  "LINE_NOT_VERIFIED",
  "LINE_REVOKED",
  "MULTIPLE_LINE_SUBJECTS",
  "MULTIPLE_CUSTOMERS",
  "MULTIPLE_FINANCE_CUSTOMERS",
  "ORG_MISMATCH",
  "LINK_CONFLICT",
  "ACCOUNT_DISABLED",
  "NO_TRUSTED_ASSOCIATION",
] as const;

export type LineBindingReviewReason = (typeof LINE_BINDING_REVIEW_REASONS)[number];

export type VerifiedLineBinding = {
  hash: string | null;
  verified: boolean;
  status: string;
  confirmedAt: string | null;
  boundAt: string | null;
  unboundAt: string | null;
  blockedAt: string | null;
};

export type LineBindingDecision =
  | { outcome: "hash"; hash: string }
  | { outcome: "review"; reason: LineBindingReviewReason };

const HASH = /^[0-9a-f]{64}$/;

export function isLineSubjectHash(value: string): boolean {
  return HASH.test(value);
}

export function decideVerifiedLineSubject(input: {
  organizationAppId: string;
  customerOrganizationAppId: string | null;
  customerStatus: string | null;
  bindings: readonly VerifiedLineBinding[];
}): LineBindingDecision {
  if (!input.customerOrganizationAppId || input.customerOrganizationAppId !== input.organizationAppId) {
    return { outcome: "review", reason: "ORG_MISMATCH" };
  }
  if (input.customerStatus !== "ACTIVE") {
    return { outcome: "review", reason: "ACCOUNT_DISABLED" };
  }
  const hashes = new Set<string>();
  let sawRevoked = false;
  let sawUnverified = false;
  for (const binding of input.bindings) {
    const hash = (binding.hash ?? "").trim().toLowerCase();
    const trusted =
      binding.verified === true &&
      binding.status === "active" &&
      Boolean(binding.confirmedAt) &&
      Boolean(binding.boundAt) &&
      !binding.unboundAt &&
      !binding.blockedAt &&
      isLineSubjectHash(hash);
    if (trusted) {
      hashes.add(hash);
      continue;
    }
    if (binding.status === "unbound" || binding.unboundAt || binding.blockedAt) sawRevoked = true;
    else if (binding.hash) sawUnverified = true;
  }
  if (hashes.size > 1) return { outcome: "review", reason: "MULTIPLE_LINE_SUBJECTS" };
  if (hashes.size === 1) return { outcome: "hash", hash: [...hashes][0] };
  if (sawRevoked) return { outcome: "review", reason: "LINE_REVOKED" };
  if (sawUnverified) return { outcome: "review", reason: "LINE_NOT_VERIFIED" };
  return { outcome: "review", reason: "NO_TRUSTED_ASSOCIATION" };
}
