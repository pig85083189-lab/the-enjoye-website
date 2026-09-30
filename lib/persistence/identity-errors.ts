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

export class UniqueEffectKeyError extends Error {
  constructor(message = "effect_key already exists") {
    super(message);
    this.name = "UniqueEffectKeyError";
  }
}
