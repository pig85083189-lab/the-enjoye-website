-- Beauty OS one-time walk-in appointments
-- Apply order: TEST / Staging first, Production only after verification.
-- Safe for existing CUSTOMER rows: booking_origin defaults to CUSTOMER and
-- guest_contact_phone stays NULL. PostgreSQL FK still allows NULL customer_id.
-- One-time walk-in appointments have no customer row or LINE claim.
-- Existing RLS policies must remain unchanged. Guest creation must use a
-- staff-authenticated, tenant-scoped write path with overlap protection.

BEGIN;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_origin text;

ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS guest_contact_phone text;

-- Backfill before enforcing NOT NULL default for older rows.
UPDATE public.appointments
SET booking_origin = 'CUSTOMER'
WHERE booking_origin IS NULL;

ALTER TABLE public.appointments
  ALTER COLUMN booking_origin SET DEFAULT 'CUSTOMER';

ALTER TABLE public.appointments
  ALTER COLUMN booking_origin SET NOT NULL;

-- Allow guest rows without a customers FK target. Existing non-null customer_id
-- rows keep their FK relationships unchanged.
ALTER TABLE public.appointments
  ALTER COLUMN customer_id DROP NOT NULL;

ALTER TABLE public.appointments
  DROP CONSTRAINT IF EXISTS appointments_one_time_guest_identity_check;

ALTER TABLE public.appointments
  ADD CONSTRAINT appointments_one_time_guest_identity_check
  CHECK (
    (booking_origin = 'CUSTOMER' AND customer_id IS NOT NULL AND guest_contact_phone IS NULL)
    OR
    (booking_origin = 'WALK_IN_ONCE' AND customer_id IS NULL
      AND NULLIF(btrim(customer_name_snapshot), '') IS NOT NULL
      AND NULLIF(btrim(guest_contact_phone), '') IS NOT NULL)
  );

COMMENT ON COLUMN public.appointments.booking_origin IS
  'CUSTOMER: linked customer; WALK_IN_ONCE: one-time booking without customer record or LINE membership';

COMMENT ON COLUMN public.appointments.guest_contact_phone IS
  'Contact phone snapshot for WALK_IN_ONCE only. Never written to customers.phone.';

COMMIT;
