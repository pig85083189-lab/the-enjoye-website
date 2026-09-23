# Tenant Isolation (Beauty OS)

Phase 4.5 / 4.5B architecture notes. Prototype uses Mock + localStorage.

**Product blueprint (Phase 4.6):** [`docs/saas/README.md`](./saas/README.md) — hierarchy, domains, ownership, lifecycle, ledgers, RBAC, entitlements.

## Two boundaries (do not confuse)

### 1. Prototype application boundary (this codebase)

- Membership validation before `switchOrganization` / accepting persisted org id
- Organization scoping on repositories, drafts, appointments, services
- Location ownership checks before `switchLocation` / accepting persisted location

These checks make the app **fail closed** and prevent accidental cross-tenant UI leakage.

**They are not production security.** A user can edit localStorage. Client-side
`organizationId` is **never** authorization proof.

### 2. Future production security boundary

- Supabase Auth (identity)
- Server-side authorization (membership verified on the server)
- Postgres RLS: `organization_id IN (memberships for auth.uid())`
- Storage paths: `{organizationId}/customers/{customerId}/...`

Until that stack exists, treat prototype gates as UX / architecture hardening only.

## Principles

1. **Tenant boundary = `organizationId`**  
   Every business entity belongs to exactly one organization.

2. **UI filter is not a security boundary**  
   Hiding rows in React is convenience only.

3. **Repository must scope by organization**  
   Core APIs require `organizationId`. No silent `getActiveOrganizationId()` fallback
   on customers / consultations / notes / photos / appointments / treatments / drafts.

4. **Membership gate for tenant selection**  
   Knowing an org id ≠ permission. `switchOrganization` and startup resolution must
   confirm an active `StaffMembership` for the current mock user.

5. **Location belongs to organization**  
   `beauty-os:{organizationId}:current-location-id`. Cross-org location ids are rejected.
   Legacy global `beauty-os:current-location-id` migrates only when ownership matches.

6. **Services are tenant-owned**  
   `getServiceById(serviceId, organizationId)` — required org scope. There is no global
   platform service catalog in this prototype. Treatment *templates* (BREAST / GENERIC)
   remain platform presentation helpers keyed by `serviceType`.

7. **Future Supabase must use RLS**  
   Derived from membership, not from a free-form client header alone.

8. **Platform admin ≠ tenant admin**  
   Separate roles; never reuse tenant OWNER credentials for platform tooling.

## Prototype helpers

- `canAccessOrganization` / `assertCanAccessOrganization` / `resolveAccessibleOrganizationId` — `lib/tenant/access.ts`
- `persistOrganizationId` / `persistCurrentLocation` / `resolveCurrentLocation` — `lib/tenant/organization-store.ts`
- `getTenantStorageKey` / `getCurrentLocationStorageKey` — `lib/tenant/storage-keys.ts`
- Dev Tenant Switcher — development only; lists **membership-accessible** orgs only

## Local persistence

```text
beauty-os:current-organization-id
beauty-os:{organizationId}:current-location-id
beauty-os:{organizationId}:customers:v1
beauty-os:{organizationId}:consultations:v1
beauty-os:{organizationId}:customer-notes:v1
beauty-os:{organizationId}:customer-photos:v1
beauty-os:{organizationId}:appointments:v1
beauty-os:{organizationId}:consultation-draft:{customerId|new}
beauty-os:{organizationId}:treatment-draft:{appointmentId}
```

Legacy Phase 4 keys (`the-enjoye:*`) migrate idempotently into THE ENJOYE only.  
Legacy global location key (`beauty-os:current-location-id`) migrates once when valid.
