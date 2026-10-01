/**
 * Organization snapshot encode/decode.
 *
 * Wire format (stable, do not invent a second store):
 *   `${authSnapshot}|${organizationId}|${orgOverrides}|${locationOverrides}|${membershipOverrides}|${locationPtr}`
 *
 * authSnapshot is either `none` or `${authUserId}|${email}` (email may be empty).
 * Authenticated orgId is therefore the field after auth id + email, never the email.
 */

export const SSR_ORGANIZATION_SNAPSHOT = "ssr";

export type OrganizationSnapshotKind = "ssr" | "unauthenticated" | "authenticated";

export type EncodedOrganizationSnapshot = {
  authSnapshot: string;
  organizationId: string;
  orgOverrides?: string;
  locationOverrides?: string;
  membershipOverrides?: string;
  locationPtr?: string;
};

export type DecodedOrganizationSnapshot = {
  kind: OrganizationSnapshotKind;
  organizationId: string;
};

export function encodeStaffAuthSnapshot(user: {
  id: string;
  email?: string | null;
} | null): string {
  if (!user) return "none";
  return `${user.id}|${user.email ?? ""}`;
}

export function encodeOrganizationSnapshot(
  input: EncodedOrganizationSnapshot,
): string {
  return [
    input.authSnapshot,
    input.organizationId,
    input.orgOverrides ?? "",
    input.locationOverrides ?? "",
    input.membershipOverrides ?? "",
    input.locationPtr ?? "",
  ].join("|");
}

export function parseOrganizationSnapshot(
  snapshot: string,
): DecodedOrganizationSnapshot {
  if (snapshot === SSR_ORGANIZATION_SNAPSHOT || snapshot.startsWith("ssr|")) {
    return { kind: "ssr", organizationId: SSR_ORGANIZATION_SNAPSHOT };
  }
  if (snapshot === "none" || snapshot.startsWith("none|")) {
    const afterNone =
      snapshot === "none" ? "" : snapshot.slice("none|".length);
    const organizationId = afterNone.split("|")[0] || "none";
    return { kind: "unauthenticated", organizationId };
  }
  const first = snapshot.indexOf("|");
  if (first < 0) {
    return { kind: "authenticated", organizationId: "none" };
  }
  const afterAuthId = snapshot.slice(first + 1);
  const second = afterAuthId.indexOf("|");
  if (second < 0) {
    return { kind: "authenticated", organizationId: "none" };
  }
  const afterEmail = afterAuthId.slice(second + 1);
  const organizationId = afterEmail.split("|")[0] || "none";
  return { kind: "authenticated", organizationId };
}

export function parseOrganizationId(snapshot: string): string {
  return parseOrganizationSnapshot(snapshot).organizationId;
}
