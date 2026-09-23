# SaaS Migration Notes (Future Supabase)

Phase 4.5 adds multi-tenant domain models in the Next.js app. Remote Supabase is still paused — do **not** `db push`, create projects, or enable Auth/Storage from this phase.

**Phase 4.6 blueprint:** see [`docs/saas/README.md`](./saas/README.md) for domain map, ownership, ledgers, checkout, RBAC, entitlements, and future data model. This file remains a short bridge to the Phase 3B SQL foundation.

## What already exists (Phase 3B migration)

In-repo SQL: `supabase/migrations/20260918120000_beauty_os_foundation.sql`

- `organizations` (minimal)
- `profiles` with `organization_id`
- customers / consultations / services / appointments / treatments / photos
- Early RLS sketches

## Gaps vs Phase 4.5 domain model

| Domain (app) | DB gap |
|--------------|--------|
| `Organization` (slug, timezone, currency, locale, status) | Extend `organizations` columns |
| `Location` | New `locations` table + FKs |
| `StaffMembership` (user ↔ org ↔ locations ↔ role) | Split from flat `profiles.role` / add membership table |
| `OrganizationSubscription` / `PlanId` | New tables — billing later, schema-ready only |
| CRM notes / photos / tags | Align JSON or normalized tables with app types |
| Treatment drafts | App-only today; decide sync strategy later |

## Recommended future steps (not this phase)

1. Additive migrations only — never delete historical migration files.
2. Backfill `organization_id` on every row; default first tenant = THE ENJOYE.
3. Introduce `locations` and optional `location_id` on appointments / treatments.
4. Replace single-profile-role with `staff_memberships`.
5. Rewrite RLS to: membership lookup → `organization_id` match (see `docs/tenant-isolation.md`).
6. Storage buckets / paths scoped by `organization_id`.
7. Stop trusting client `organizationId`; resolve from Auth session + membership.

## App ↔ DB mapping intent

- App `organizationId` ↔ DB `organization_id`
- App `StaffMembership.userId` ↔ Auth user / `profiles.id`
- App repository interfaces should map 1:1 to scoped Supabase queries later (`Local*` → `Supabase*` without UI rewrite)

## Explicitly out of scope until later

Stripe, real Auth, real RLS enforcement on remote, SaaS signup, invitations, platform admin, white-label, custom domains.
