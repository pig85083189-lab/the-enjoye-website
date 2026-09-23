# Platform Admin Boundary

Phase 4.6. Platform = Beauty OS SaaS operator. Organization = paying tenant brand.

---

## Separation principle

```text
Platform authorization  ≠  Organization authorization
```

| Actor | Authenticates as | Can do |
|-------|------------------|--------|
| Platform Admin | Platform identity | Manage orgs, plans, subscriptions, support tools |
| Org OWNER | StaffMembership role OWNER | Manage **one** tenant’s data |
| Org STAFF | Membership | Operate within assigned locations |

**Forbidden:** granting a Platform Admin powers by inserting them as OWNER into every Organization (unless explicit “break-glass” support membership with audit — still separate platform audit trail).

---

## Platform Admin capabilities (future)

- List / search Organizations  
- View subscription status, plan, trial ends  
- Suspend / reinstate Organization (`SUSPENDED`)  
- Adjust entitlements / plan (with audit)  
- Usage meters (locations, staff, customers, storage)  
- Support: read-only tenant diagnostics (scoped, audited)  
- Platform-wide audit log  
- Feature flags / entitlement definitions  

**Out of Platform Admin:**

- Editing customer clinical notes as if a therapist (unless break-glass + reason)  
- Using org Checkout as platform  

---

## Domain objects (platform-owned)

| Entity | Purpose |
|--------|---------|
| `PlatformUser` | Operator accounts |
| `PlatformRole` | e.g. SUPPORT, BILLING, SUPERADMIN |
| `Organization` (lifecycle) | Create/suspend from platform |
| `OrganizationSubscription` | Plan linkage |
| `EntitlementDefinition` | Feature catalog |
| `UsageSnapshot` | Metering |
| `PlatformAuditLog` | Who did what to which org |

---

## Security notes

1. Platform routes must not reuse `/staff/*` org shell blindly.  
2. Separate cookie / session claim: `platform_role` vs `org_membership`.  
3. Future RLS: platform role bypass is a **separate** policy path, never “org_id = anything”.  
4. Client-selected organizationId remains non-authoritative for both worlds.

---

## Phase 4.6

Documentation only — **no Platform Admin UI**.
