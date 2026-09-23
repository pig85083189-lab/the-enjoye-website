# Beauty OS — SaaS Product Architecture Blueprint

**Phase 4.6** · Product / Domain Architecture  
**Status:** Blueprint only — no large runtime feature work  
**Prerequisite:** Phase 4.5B SaaS Boundary Hardening (accepted)

Beauty OS is a **multi-tenant SaaS** for beauty / SPA / body / breast care / facial / waxing businesses.  
THE ENJOYE is the **first Organization tenant**, not the platform itself.

---

## Document index

| Document | Purpose |
|----------|---------|
| [domain-map.md](./domain-map.md) | Full domain inventory & relationships |
| [entity-ownership.md](./entity-ownership.md) | Platform / Org / Location ownership matrix |
| [business-lifecycle.md](./business-lifecycle.md) | Customer → Appointment → Treatment → Checkout → Follow-up |
| [package-ledger.md](./package-ledger.md) | Phase 4.9B package definition · customer package · ledger |
| [stored-value-ledger.md](./stored-value-ledger.md) | Phase 4.9B stored value account · top-up · payment |
| [core-business-flow.md](./core-business-flow.md) | Phase 4.9C end-to-end SoT map |
| [domain-invariants.md](./domain-invariants.md) | Tenant · location · money · idempotency invariants |
| [checkout.md](./checkout.md) | CheckoutDraft · payments · mixed tender · eligibility |
| [transaction-domain.md](./transaction-domain.md) | Immutable Transaction · snapshots · void metadata |
| [transaction-void.md](./transaction-void.md) | Phase 4.10A full void + ledger reversal |
| [product-domain.md](./product-domain.md) | Phase 4.10B Product catalog (≠ inventory) |
| [retail-sales.md](./retail-sales.md) | Phase 4.10B walk-in retail + mixed cart |
| [inventory-domain.md](./inventory-domain.md) | Phase 4.10C location stock + movement model |
| [inventory-movements.md](./inventory-movements.md) | Sale deduction · void restore · receive/adjust |
| [rbac.md](./rbac.md) | Roles, permissions, location access |
| [platform-admin.md](./platform-admin.md) | Platform vs Organization security |
| [entitlements.md](./entitlements.md) | Plans → entitlements (not `if plan === PRO`) |
| [mvp-roadmap.md](./mvp-roadmap.md) | MVP CORE / NEXT / LATER + IA recommendation |
| [navigation-ia.md](./navigation-ia.md) | Phase 4.7 Staff shell IA · routes · role visibility |
| [calendar-ux.md](./calendar-ux.md) | Calendar desktop / tablet / mobile UX (4.8A–4.8B) |
| [staff-scheduling.md](./staff-scheduling.md) | Phase 4.8B working hours, breaks, time off |
| [availability-engine.md](./availability-engine.md) | Availability reasons, status blocking, override |
| [current-to-future-map.md](./current-to-future-map.md) | Keep / Extend / Replace for existing code |
| [future-data-model.md](./future-data-model.md) | Future Supabase grouping (design only) |

Related (pre–4.6):

- [`../tenant-isolation.md`](../tenant-isolation.md) — application vs security boundary
- [`../saas-migration-notes.md`](../saas-migration-notes.md) — early Supabase gaps
- [`../database-schema.md`](../database-schema.md) — Phase 3B foundation schema notes

---

## SaaS hierarchy (canonical)

```text
BeautyOS Platform          ← SaaS operator (Beauty OS company)
└── Organization           ← beauty brand / company / studio (tenant)
    ├── Location(s)        ← physical stores
    ├── StaffMembership    ← User ↔ Organization (+ locationIds, role)
    └── Tenant business data (customers, services, appointments, …)
```

| Concept | Meaning | Security boundary |
|---------|---------|-------------------|
| **Platform** | Beauty OS SaaS operator | Platform Admin auth — **not** org membership |
| **Organization** | Tenant (e.g. THE ENJOYE, LUMIÈRE BEAUTY) | Membership + future RLS by `organization_id` |
| **Location** | Store under an Organization | Org-owned; ops often location-scoped |
| **User** | Login identity (future Auth user) | Global identity; access via memberships |
| **StaffMembership** | User’s relationship to one Organization | Role + locationIds + future permissions |

**Invariant:** Platform Admin ≠ Organization OWNER. Never fake platform power with a tenant OWNER role.

---

## Architecture invariants

1. Every tenant-owned business record belongs to **exactly one** Organization.
2. Client-selected `organizationId` is **context**, not authorization.
3. Location scope **never replaces** Organization ownership.
4. Customer identity is **Organization-wide** (shared across locations) unless requirements explicitly change.
5. Financial balances are derived from **immutable ledger entries** whenever practical.
6. **Treatment** (clinical/service record) and **Transaction** (commercial sale) are separate domains.
7. **Platform authorization** is separate from **Organization authorization**.
8. Plan **names** do not directly control UI/business logic; **entitlements** do.
9. Cross-tenant access must **fail closed**.
10. Supabase RLS will eventually be the final data security boundary — **not implemented in Phase 4.6**.

---

## What Phase 4.5B already provides (keep)

- Organization / Location / StaffMembership types & seed
- `canAccessOrganization` / location gates / fail-closed recovery
- Org-scoped repositories & localStorage keys
- Enjoye ↔ Lumière isolation tests (25)

Phase 4.6 **does not** rewrite that boundary layer. It documents how to grow domains on top of it.

---

## Phase 4.6 non-goals

No Supabase push / Auth / RLS · no Checkout/Package UI · no Inventory/AI/Billing/Stripe · no StaffShell navigation rewrite · no commit/push.

---

## Suggested next phases (not started)

| Phase | Focus |
|-------|--------|
| **4.7** | Navigation / IA implementation aligned with MVP |
| **4.8+** | Domain types & local prototypes for Package / Checkout |
| **5** | Supabase Auth + persistence + RLS (when approved) |
