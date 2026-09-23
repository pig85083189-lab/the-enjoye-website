# Beauty OS — Database Schema

Foundation schema for the staff Beauty OS platform.  
**THE ENJOYE** is the first tenant organization — not the platform itself.

UI still uses Mock / localStorage (Phase 4.5). Remote Supabase remains paused.

See also:

- `docs/tenant-isolation.md`
- `docs/saas-migration-notes.md`

## Entity relationship (overview)

```text
Organization  (tenant root)
├── Locations
├── Staff Memberships  (User → Org → Role → LocationIds)
├── Subscription (future billing placeholder)
├── Profiles (staff identity; future Auth)
├── Customers
│   ├── Customer Consultations
│   ├── Customer Notes
│   └── Customer Photos
├── Services
├── Appointments  (Customer + Service + optional Staff / Location)
├── Treatments    (Customer + Service + optional Appointment / Staff / Location)
│   └── Treatment Photos (metadata only)
└── Audit Logs
```

## Tables

### `organizations`
Multi-tenant root. Beauty OS hosts many organizations; THE ENJOYE is org #1.

| Column | Notes |
|--------|--------|
| `id` | uuid PK |
| `name` | display name |
| `slug` | unique |
| `logo_url` / `phone` / `email` / `address` | optional |
| `timezone` / `currency` / `locale` | e.g. Asia/Taipei, TWD, zh-TW |
| `status` | ACTIVE / TRIAL / SUSPENDED / ARCHIVED |
| `created_at` / `updated_at` | timestamptz |

### `locations` (Phase 4.5 domain — future migration)
One organization may have many stores.

| Column | Notes |
|--------|--------|
| `organization_id` | FK → organizations |
| `name` / `code` / `phone` / `address` / `timezone` | |
| `is_primary` / `is_active` | |

### `staff_memberships` (Phase 4.5 domain — future migration)
Do not equate Staff User with a single org forever.

| Column | Notes |
|--------|--------|
| `organization_id` | FK |
| `user_id` | → auth.users / profiles |
| `location_ids` | uuid[] or join table |
| `role` | OWNER / MANAGER / STAFF (+ future RECEPTIONIST / ACCOUNTANT) |
| `display_name` / `is_active` | |

### `profiles`
Staff identity. `id` references `auth.users(id)` (Auth users not created in 3B).

| Column | Notes |
|--------|--------|
| `organization_id` | FK → organizations (legacy 3B; migrate toward memberships) |
| `full_name` / `display_name` / `phone` / `avatar_url` | |
| `role` | enum `staff_role`: OWNER, MANAGER, THERAPIST, RECEPTIONIST |
| `is_active` | |

### `customers`
Operational customer record. Health / questionnaire detail lives elsewhere.

| Column | Notes |
|--------|--------|
| `organization_id` | **required** tenant boundary |
| `customer_number`, names, phone, email, birthday, gender | |
| `line_user_id`, `source` | optional channels |
| `first_visit_date` / `last_visit_date` / `visit_count` | |
| `is_vip` | |
| `status` | enum `customer_status`: ACTIVE, INACTIVE, ARCHIVED |
| `notes` | free-text ops notes (not full consultation) |

Customers belong to an **organization**, not a single location.

### `customer_consultations`
Long-lived consultation / consent profile per customer.

| Column | Notes |
|--------|--------|
| `organization_id` | required |
| `consultation_data` | **jsonb** — evolving questionnaire |
| `allergies` / `important_notes` | |
| `consent_confirmed` / `consent_confirmed_at` | |
| `created_by` / `updated_by` | → profiles |

### `services`
Catalog of SPA offerings.

| Column | Notes |
|--------|--------|
| `organization_id` | required |
| `service_type` | enum — template registry key (not display name) |
| `duration_minutes` | must be > 0 |
| `price` | optional numeric |
| `is_active` | |

`service_type` values (DB):  
`BREAST`, `BODY_SCULPTING`, `FACIAL`, `WOMB_CARE`, `DETOX`, `NAVEL_CANDLE`, `EXFOLIATION`, `WAXING`, `OTHER`

### `appointments`
Scheduled bookings. No payment / session deduction in this phase.

| Column | Notes |
|--------|--------|
| `organization_id` | required |
| `location_id` | optional FK → locations |
| `starts_at` / `ends_at` | `ends_at > starts_at` |
| `status` | BOOKED → … → COMPLETED / CANCELLED / NO_SHOW |
| `customer_note` / `internal_note` | |

### `treatments`
One actual service session record.

| Column | Notes |
|--------|--------|
| `organization_id` | required |
| `location_id` | optional |
| `mode` | STANDARD / QUICK |
| `template_type` | `service_type` used for the template |
| `assessment`, `body_markers`, `operations`, `products`, `follow_up`, `skipped_steps` | **jsonb** |
| `professional_note` / `client_feeling` | text |
| `status` | DRAFT / COMPLETED / VOID |

JSONB is intentional in Phase 3B: workflow payloads still evolve with the Treatment Template system; normalize into child tables only when query needs appear.

### `treatment_photos`
Photo **metadata only**. No Storage bucket yet. Store private `storage_path`, never public URLs.

| Column | Notes |
|--------|--------|
| `organization_id` | required (tenant scope) |
| `photo_type` | BEFORE / AFTER / OTHER |
| `storage_path` | private path placeholder — future: `{organization_id}/...` |
| `sort_order` | ≥ 0 |

### `audit_logs`
Append-oriented audit trail (no complex row triggers in 3B).

| Column | Notes |
|--------|--------|
| `organization_id` | required |
| `action` / `entity_type` / `entity_id` | |
| `metadata` | jsonb |
| `actor_id` | → profiles |

## RLS (Phase 3B + 4.5 intent)

- RLS enabled on all business tables above.
- **No anon policies** on customers / appointments / treatments / photos.
- Helpers (security definer, `search_path = public`):
  - `current_organization_id()` — from membership / profiles where `id = auth.uid()`
  - `current_staff_role()` — same
- Authenticated staff: CRUD only when `organization_id` matches membership.
- Do **not** trust client-sent `organization_id` alone.
- Platform admin policies must stay separate from tenant OWNER.

## Migration status

SQL lives in:

`supabase/migrations/20260918120000_beauty_os_foundation.sql`

**Status: migration exists in the repository only — not applied to remote Supabase** (no `db push` from Phase 3B / 4.5).

Phase 4.5 does **not** add a new remote migration. Schema deltas are documented in `docs/saas-migration-notes.md` for a future additive migration.

The Next.js app does **not** auto-apply migrations and still uses Mock / localStorage for staff UI.
