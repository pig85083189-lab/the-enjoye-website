import { afterEach, describe, expect, it } from "vitest";
import {
  LOC_ENJOYE_PRIMARY_ID,
  MEMBERSHIP_ENJOYE_OWNER_ID,
  MEMBERSHIP_LUMIERE_STAFF_ID,
  ORG_ENJOYE_ID,
  ORG_LUMIERE_ID,
} from "@/lib/tenant/constants";
import { parseOrganizationId } from "@/lib/tenant/OrganizationContext";
import {
  encodeOrganizationSnapshot,
  encodeStaffAuthSnapshot,
  parseOrganizationSnapshot,
} from "@/lib/tenant/organization-snapshot";
import {
  getOrganizationSnapshot,
  persistOrganizationId,
  updateMembership,
} from "@/lib/tenant/organization-store";
import {
  getStaffAuthSnapshot,
  resetStaffAuthForTests,
  setStaffAuthUserForTests,
} from "@/lib/staff-auth/session";

const AUTH_A = "11111111-1111-4111-8111-111111111111";

describe("organization snapshot encode/decode", () => {
  afterEach(() => {
    resetStaffAuthForTests();
    localStorage.clear();
  });

  it("encodes unauthenticated snapshots without treating orgId as email", () => {
    const encoded = encodeOrganizationSnapshot({
      authSnapshot: encodeStaffAuthSnapshot(null),
      organizationId: ORG_ENJOYE_ID,
    });
    expect(encoded.startsWith(`none|${ORG_ENJOYE_ID}|`)).toBe(true);
    expect(parseOrganizationSnapshot(encoded)).toEqual({
      kind: "unauthenticated",
      organizationId: ORG_ENJOYE_ID,
    });
    expect(parseOrganizationId(encoded)).toBe(ORG_ENJOYE_ID);
    expect(parseOrganizationId("none|none|||")).toBe("none");
  });

  it("authenticated empty email does not treat email as orgId", () => {
    const encoded = encodeOrganizationSnapshot({
      authSnapshot: encodeStaffAuthSnapshot({ id: AUTH_A, email: "" }),
      organizationId: ORG_ENJOYE_ID,
    });
    expect(parseOrganizationId(encoded)).toBe(ORG_ENJOYE_ID);
    expect(parseOrganizationId(encoded)).not.toBe("");
    expect(parseOrganizationSnapshot(encoded).kind).toBe("authenticated");
  });

  it("authenticated email value is not parsed as orgId", () => {
    const email = "owner@theenjoye.example";
    const encoded = encodeOrganizationSnapshot({
      authSnapshot: encodeStaffAuthSnapshot({ id: AUTH_A, email }),
      organizationId: ORG_ENJOYE_ID,
    });
    expect(parseOrganizationId(encoded)).toBe(ORG_ENJOYE_ID);
    expect(parseOrganizationId(encoded)).not.toBe(email);
    expect(parseOrganizationSnapshot("ssr|ignored").kind).toBe("ssr");
  });

  it("live snapshot with email still yields orgId, never the email", () => {
    setStaffAuthUserForTests({
      id: AUTH_A,
      email: "owner@theenjoye.example",
    });
    const auth = getStaffAuthSnapshot();
    expect(auth).toBe(`${AUTH_A}|owner@theenjoye.example`);
    const snapshot = getOrganizationSnapshot();
    expect(snapshot.startsWith(`${auth}|`)).toBe(true);
    const orgId = parseOrganizationId(snapshot);
    expect(orgId).not.toBe("owner@theenjoye.example");
    expect(orgId === ORG_ENJOYE_ID || orgId === "none").toBe(true);
  });

  it("organization switch updates snapshot orgId for a multi-org auth user", () => {
    updateMembership(ORG_ENJOYE_ID, MEMBERSHIP_ENJOYE_OWNER_ID, {
      authUserId: AUTH_A,
    });
    updateMembership(ORG_LUMIERE_ID, MEMBERSHIP_LUMIERE_STAFF_ID, {
      authUserId: AUTH_A,
    });
    setStaffAuthUserForTests({ id: AUTH_A, email: "owner@theenjoye.example" });
    expect(persistOrganizationId(ORG_ENJOYE_ID, "staff-001")).toBe(true);
    expect(parseOrganizationId(getOrganizationSnapshot())).toBe(ORG_ENJOYE_ID);
    expect(persistOrganizationId(ORG_LUMIERE_ID, "staff-001")).toBe(true);
    expect(parseOrganizationId(getOrganizationSnapshot())).toBe(ORG_LUMIERE_ID);
    expect(persistOrganizationId("org-not-mine", "staff-001")).toBe(false);
    expect(parseOrganizationId(getOrganizationSnapshot())).toBe(ORG_LUMIERE_ID);
    void LOC_ENJOYE_PRIMARY_ID;
  });
});
