import { describe, expect, it } from "vitest";
import { verifyPackageCheckoutActorScope } from "./package-checkout-actor-scope";

const booking = {
  authUserId: "auth-1", userId: "staff-1", role: "MANAGER",
  isActive: true, locationIds: [] as string[],
};
const finance = { ...booking };
const valid = { authenticatedUserId: "auth-1", booking, finance, locationId: "loc-a" };

describe("cross-database package checkout authorization", () => {
  it("permits matching active checkout actors with unrestricted branches", () => {
    expect(verifyPackageCheckoutActorScope(valid)).toBe(true);
  });
  it("denies impersonated login identity", () => {
    expect(verifyPackageCheckoutActorScope({ ...valid, authenticatedUserId: "auth-other" })).toBe(false);
  });
  it("denies finance actor mismatch", () => {
    expect(verifyPackageCheckoutActorScope({ ...valid, finance: { ...finance, authUserId: "auth-other" } })).toBe(false);
    expect(verifyPackageCheckoutActorScope({ ...valid, finance: { ...finance, userId: "staff-other" } })).toBe(false);
  });
  it("denies inactive actors and roles without checkout rights", () => {
    expect(verifyPackageCheckoutActorScope({ ...valid, booking: { ...booking, isActive: false } })).toBe(false);
    expect(verifyPackageCheckoutActorScope({ ...valid, finance: { ...finance, isActive: false } })).toBe(false);
    expect(verifyPackageCheckoutActorScope({ ...valid, booking: { ...booking, role: "ACCOUNTANT" }, finance: { ...finance, role: "ACCOUNTANT" } })).toBe(false);
  });
  it("requires both databases to authorize the same branch", () => {
    expect(verifyPackageCheckoutActorScope({ ...valid, booking: { ...booking, locationIds: ["loc-b"] } })).toBe(false);
    expect(verifyPackageCheckoutActorScope({ ...valid, finance: { ...finance, locationIds: ["loc-b"] } })).toBe(false);
    expect(verifyPackageCheckoutActorScope({ ...valid, booking: { ...booking, locationIds: ["loc-a"] }, finance: { ...finance, locationIds: ["loc-a"] } })).toBe(true);
  });
  it("rejects mismatched role or empty location", () => {
    expect(verifyPackageCheckoutActorScope({ ...valid, finance: { ...finance, role: "STAFF" } })).toBe(false);
    expect(verifyPackageCheckoutActorScope({ ...valid, locationId: "" })).toBe(false);
  });
});
