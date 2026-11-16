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
  source: "binding" | "member_link";
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

function hashOf(binding: VerifiedLineBinding): string {
  return (binding.hash ?? "").trim().toLowerCase();
}

function at(value: string | null): number {
  if (!value) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
}

function bindingIsRevoked(binding: VerifiedLineBinding): boolean {
  return binding.source === "binding" && (
    binding.status === "unbound" || Boolean(binding.unboundAt) || Boolean(binding.blockedAt)
  );
}

function bindingIsCurrent(binding: VerifiedLineBinding): boolean {
  return binding.source === "binding" &&
    binding.verified === true &&
    binding.status === "active" &&
    Boolean(binding.confirmedAt) &&
    Boolean(binding.boundAt) &&
    !binding.unboundAt &&
    !binding.blockedAt &&
    isLineSubjectHash(hashOf(binding));
}

/**
 * A hash stays revoked when the latest binding event is an unbind or block.
 * A later active rebind supersedes that revocation. A member-link
 * verified_at value never supersedes it.
 */
function hashIsRevoked(hash: string, bindings: readonly VerifiedLineBinding[]): boolean {
  const rows = bindings.filter((binding) => binding.source === "binding" && hashOf(binding) === hash);
  const revokedRows = rows.filter(bindingIsRevoked);
  if (revokedRows.length === 0) return false;
  const revokedAt = revokedRows.reduce(
    (latest, binding) => Math.max(latest, at(binding.unboundAt), at(binding.blockedAt)),
    Number.NEGATIVE_INFINITY,
  );
  const reboundAt = rows.filter(bindingIsCurrent).reduce(
    (latest, binding) => Math.max(latest, at(binding.boundAt)),
    Number.NEGATIVE_INFINITY,
  );
  return reboundAt <= revokedAt;
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
    const hash = hashOf(binding);
    if (!isLineSubjectHash(hash)) continue;
    if (hashIsRevoked(hash, input.bindings)) {
      sawRevoked = true;
      continue;
    }
    const memberLinkTrusted = binding.source === "member_link" &&
      binding.verified === true &&
      Boolean(binding.confirmedAt);
    if (bindingIsCurrent(binding) || memberLinkTrusted) hashes.add(hash);
    else sawUnverified = true;
  }
  if (hashes.size > 1) return { outcome: "review", reason: "MULTIPLE_LINE_SUBJECTS" };
  if (hashes.size === 1) return { outcome: "hash", hash: [...hashes][0] };
  if (sawRevoked) return { outcome: "review", reason: "LINE_REVOKED" };
  if (sawUnverified) return { outcome: "review", reason: "LINE_NOT_VERIFIED" };
  return { outcome: "review", reason: "NO_TRUSTED_ASSOCIATION" };
}

/**
 * Read-side membership. A current binding wins. A hashless member
 * verified_at still counts when nothing has been revoked. It cannot
 * revive a binding whose latest event is an unbind or block.
 */
export function lineMembershipIsCurrent(
  bindings: readonly VerifiedLineBinding[],
  memberVerified: boolean,
): boolean {
  const hashes = new Set<string>();
  let revoked = false;
  for (const binding of bindings) {
    const hash = hashOf(binding);
    if (!isLineSubjectHash(hash)) continue;
    if (hashIsRevoked(hash, bindings)) {
      revoked = true;
      continue;
    }
    if (bindingIsCurrent(binding) || (binding.source === "member_link" && binding.verified)) hashes.add(hash);
  }
  if (hashes.size > 0) return true;
  if (revoked) return false;
  return memberVerified;
}
