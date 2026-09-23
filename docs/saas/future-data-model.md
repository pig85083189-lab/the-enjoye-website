# Future Data Model (Supabase mapping — design only)

Phase 4.6. **No migration SQL. No db push. No RLS deploy.**

This document groups future tables. Additive migrations only when a later phase approves.

---

## Common columns

Most tenant tables:

| Column | Required | Notes |
|--------|----------|-------|
| `id` | yes | uuid |
| `organization_id` | **yes** for tenant data | RLS key |
| `location_id` | see matrix | |
| `created_at` / `updated_at` | yes | timestamptz |
| `created_by` / `updated_by` | recommended | auth user id |

---

## `organization_id` / `location_id` rules

| Entity | `organization_id` | `location_id` |
|--------|-------------------|---------------|
| organizations | PK | — |
| locations | required | PK |
| staff_memberships | required | — (use `location_ids[]` or join) |
| customers | **required** | **nullable** (home store optional) |
| customer_consultations | required | nullable |
| customer_notes | required | nullable |
| services | required | nullable (org menu) |
| appointments | **required** | **required** |
| appointment_status_events | required | required |
| treatments | **required** | **nullable** (prefer set from appointment) |
| treatment_photos | required | nullable |
| packages (catalog) | required | nullable |
| customer_packages | required | nullable |
| package_ledger_entries | required | nullable |
| stored_value_ledger_entries | required | nullable |
| transactions | **required** | **required** |
| transaction_items | required | (via transaction) |
| payments | required | (via transaction) |
| products | required | nullable |
| inventory_stocks | required | **required** |
| inventory_movements | required | **required** |
| follow_ups | required | nullable |
| organization_subscriptions | required (org) | — |
| plans / entitlement_definitions | platform | — |
| platform_audit_logs | platform | — |

---

## Suggested table groups

### Tenancy

`organizations` · `locations` · `users`/`profiles` · `staff_memberships` · `staff_membership_permissions` (later)

### Customer

`customers` · `customer_tags` · `customer_tag_links` · `customer_consultations` · `customer_notes` · `customer_photos`

### Catalog

`services` · `service_categories` · `packages` · `products`

### Scheduling & clinical

`appointments` · `appointment_status_events` · `treatments` · `treatment_body_markers` · `treatment_photos`

### Staff schedule (Phase 4.8B → Supabase later)

`staff_working_hours` · `staff_breaks` · `staff_time_off` · (future) `location_business_hours` · `resources` · `appointment_resources` · `staff_service_capabilities`

### Commerce

`transactions` · `transaction_items` · `payments` · `customer_packages` · `package_ledger_entries` · `stored_value_accounts` · `stored_value_ledger_entries`

### CRM

`follow_ups` · `rebooking_tasks`

### Platform

`plans` · `organization_subscriptions` · `entitlement_definitions` · `organization_entitlement_overrides` · `usage_snapshots` · `platform_users` · `platform_audit_logs`

---

## RLS sketch (future — not implemented)

```sql
-- Pseudocode only
organization_id IN (
  SELECT organization_id FROM staff_memberships
  WHERE user_id = auth.uid() AND is_active = true
)
```

Platform admin policies are a **separate** claim path — never `OR true` for all orgs in tenant policies.

Storage paths:

```text
{organization_id}/customers/{customer_id}/...
{organization_id}/treatments/{treatment_id}/...
```

---

## Relation to Phase 3B migration

Existing `supabase/migrations/20260918120000_beauty_os_foundation.sql` is a starting point.  
Gaps (locations, memberships, ledgers, transactions) are listed in `docs/saas-migration-notes.md` and this file.  
**Do not delete historical migrations.**

---

## Phase gate

Implementing this model requires an explicit later phase approval (Auth + persistence + RLS). Phase 4.6 ends at documentation.
