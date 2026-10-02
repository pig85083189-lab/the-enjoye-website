/** Fail-closed identity errors. Never fallback to seed or another org. */

export class UnmappedIdentityError extends Error {
  readonly kind: string;
  readonly organizationAppId?: string;
  readonly appId?: string;

  constructor(kind: string, organizationAppId: string | undefined, appId: string) {
    super(
      `Unmapped ${kind} app_id ${JSON.stringify(appId)}` +
        (organizationAppId ? ` in organization ${JSON.stringify(organizationAppId)}` : ""),
    );
    this.name = "UnmappedIdentityError";
    this.kind = kind;
    this.organizationAppId = organizationAppId;
    this.appId = appId;
  }
}

export type IdentityCatalogFailureReason =
  | "unauthenticated"
  | "missing_membership"
  | "ambiguous_membership"
  | "ambiguous_mapping"
  | "missing_mapping"
  | "invalid_operational_staff";

export class IdentityCatalogError extends Error {
  readonly reason: IdentityCatalogFailureReason;

  constructor(reason: IdentityCatalogFailureReason, message: string) {
    super(message);
    this.name = "IdentityCatalogError";
    this.reason = reason;
  }
}

export class UniqueEffectKeyError extends Error {
  constructor(message = "effect_key already exists") {
    super(message);
    this.name = "UniqueEffectKeyError";
  }
}
