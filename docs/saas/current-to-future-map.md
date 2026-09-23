# Current → Future Mapping

Phase 4.6. Principle: **do not break Phase 4.5B** for the sake of the blueprint.

| Current Entity / Module | Current Responsibility | Future Domain | Keep / Extend / Replace Later | Migration Risk |
|-------------------------|------------------------|---------------|-------------------------------|----------------|
| `Organization` (`types/saas.ts`) | Tenant root | TENANCY | **Keep** · extend columns | Low |
| `Location` | Stores | TENANCY | **Keep** · multi-location UX later | Low |
| `StaffMembership` | User↔Org + role + locationIds | STAFF / RBAC | **Extend** permissions map | Medium |
| `OrganizationSubscription` / `PlanId` / `FeatureKey` | Prototype entitlements | SAAS PLATFORM | **Extend** numeric limits | Low |
| `canAccessOrganization` et al. | App boundary | Security (client layer) | **Keep**; server/RLS later | Low |
| `Customer` + CRM fields | Org CRM | CUSTOMER | **Keep** · org-wide identity | Low |
| `CustomerConsultation` | Versioned consult | CUSTOMER | **Keep** | Low |
| `CustomerNote` / Tags / Photos | Internal CRM | CUSTOMER | **Keep** | Low |
| `Service` + `organizationId` | Tenant menu | SERVICE | **Keep** | Low |
| Treatment templates (`serviceType`) | UX recipes | SERVICE (platform templates) | **Keep** as Platform catalog | Low |
| `ScheduleAppointment` + schedule store | Calendar, Today, customer history | APPOINTMENT | **Keep** · Supabase later | Medium (local → DB) |
| `AppointmentStatus` `pending\|in_progress\|completed` | Today card compatibility | Canonical status | **Mapped** via `normalizeAppointmentStatus` | Low while adapter remains |
| `TreatmentDraft` / completed treatments | Workflow + history | TREATMENT | **Keep** · sync strategy later | Medium (local → DB) |
| Customer `packages[]` + `remainingSessions` | Seed CRM residue | PACKAGE | **Deprecated** · Wallet/ledger SoT (4.9C) | Low if unused in UI |
| localStorage tenant keys | Prototype persistence | — | **Keep** until Supabase | Low |
| Mock Auth `enjoye-staff-auth` | Login | User Auth | **Replace Later** with Supabase Auth | Medium |
| DevTenantSwitcher | Isolation testing | — | **Keep** (dev only) | None |
| Org / Location settings pages | Local edits | SETTINGS | **Extend** | Low |
| StaffShell / Bottom Nav | IA | NAV | **Extend** in 4.7 — not 4.6 | Low |
| Phase 3B SQL foundation | Early tables | DATA | **Extend** additively | Medium |
| Platform Admin | — | PLATFORM | **New** later | — |
| Checkout / Transaction | Phase 4.9A–4.10B local commerce | CHECKOUT | **Extend** · Supabase later | Medium |
| Package ledger | Phase 4.9B `lib/packages` | PACKAGE | **Keep** · Supabase later | Medium |
| Stored value ledger | Phase 4.9B `lib/stored-value` | STORED VALUE | **Keep** · Supabase later | Medium |
| Product catalog | Phase 4.10B `lib/products` | PRODUCT | **Keep** · inventory separate | Low |
| Inventory movements | Phase 4.10C `lib/inventory` | INVENTORY | **Keep** · no cost/transfer yet | Medium |
| `Service.priceMinor` | List price integer TWD | SERVICE | **Keep** · snapshot at checkout | Low |

---

## What to preserve unchanged in near term

1. Tenant isolation helpers and tests (4.5B).  
2. Treatment step workflow UX.  
3. Customer CRM list/profile/consultation flows.  
4. Repository interfaces taking required `organizationId`.  

## Highest migration risks

1. **Package remainingSessions** on Customer — CRM strips to `[]` (4.9C); seed residue only. Keep field until schema drop.  
2. **Appointment status enum** expansion — needs explicit mapping from `pending` / `in_progress`.  
3. **Treatment drafts in localStorage** — define sync/conflict rules before multi-device staff.
