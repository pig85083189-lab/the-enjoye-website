# Plans & Feature Entitlements

Phase 4.6. **Do not** scatter `if (plan === "PRO")` in UI/business logic.

---

## Plans (names only — no pricing)

| PlanId (future) | Intent |
|-----------------|--------|
| `TRIAL` / `FREE_TRIAL` | Evaluation |
| `STARTER` | Single-location small studio |
| `PRO` | Growing brand, CRM/reports |
| `BUSINESS` | Multi-location + advanced permissions |

Existing prototype already has `PlanId` / `OrganizationSubscription` / `FeatureKey` / `canUseFeature` — extend toward **limit entitlements**, not only boolean features.

---

## Entitlement layer

Resolve:

```text
OrganizationSubscription.planId
  → EntitlementSet
  → enforce in server (later) / soft-check in UI (prototype)
```

### Example entitlement keys

| Key | Type | Example |
|-----|------|---------|
| `locations.max` | number | 1 / 3 / unlimited |
| `staff.max` | number | 3 / 20 / unlimited |
| `customers.max` | number | 500 / unlimited |
| `reports.advanced` | boolean | false / true |
| `crm.automation` | boolean | |
| `inventory.enabled` | boolean | |
| `ai.enabled` | boolean | |
| `multi_location` | boolean | alias of locations.max > 1 |
| `advanced_permissions` | boolean | custom RBAC |

### Boolean features (align with current `FeatureKey`)

`CUSTOMER_CRM` · `CONSULTATION` · `TREATMENTS` · `APPOINTMENTS` · `PHOTOS` · `REPORTS` · `MULTI_LOCATION` · `ADVANCED_PERMISSIONS`

Keep FeatureKey for coarse gates; add numeric limits as a parallel map.

---

## Enforcement rules

1. UI may hide upsell features; **server** must reject over-limit creates.  
2. Changing plan updates entitlement snapshot; do not hardcode plan branches in domain services.  
3. Platform Admin may grant temporary entitlement overrides (audited).  
4. Prototype `canUseFeature(plan, feature)` remains non-security.

---

## Billing (explicitly later)

Stripe / invoices / proration / tax — **out of scope** until a dedicated billing phase.  
Architecture only reserves `OrganizationSubscription` status: `TRIALING` | `ACTIVE` | `PAST_DUE` | `CANCELED`.
