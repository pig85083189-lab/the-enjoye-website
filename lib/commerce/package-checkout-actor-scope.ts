/**
 * Cross-database package checkout authorization. Both independent membership
 * stores must agree before a finance transaction may be considered.
 * This is a pure gate, not a payment authorization token.
 */
export interface PackageCheckoutActorScope {
  authUserId: string;
  userId: string;
  role: string;
  isActive: boolean;
  locationIds: readonly string[];
}
export interface FinanceCheckoutMembership {
  authUserId: string;
  userId: string;
  role: string;
  isActive: boolean;
  locationIds: readonly string[];
}
const CHECKOUT_ROLES = new Set(["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"]);
export function verifyPackageCheckoutActorScope(input: {
  authenticatedUserId: string;
  booking: PackageCheckoutActorScope;
  finance: FinanceCheckoutMembership;
  locationId: string;
}): boolean {
  const { authenticatedUserId, booking, finance, locationId } = input;
  if (!authenticatedUserId || !locationId || !booking.isActive || !finance.isActive) return false;
  if (booking.authUserId !== authenticatedUserId || finance.authUserId !== authenticatedUserId) return false;
  if (!booking.userId || booking.userId !== finance.userId) return false;
  if (booking.role !== finance.role || !CHECKOUT_ROLES.has(booking.role)) return false;
  if (booking.locationIds.length > 0 && !booking.locationIds.includes(locationId)) return false;
  if (finance.locationIds.length > 0 && !finance.locationIds.includes(locationId)) return false;
  return true;
}
