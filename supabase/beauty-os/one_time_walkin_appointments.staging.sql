-- STAGING DRAFT ONLY. Do not run on production until all appointment
-- writers/readers, member scope, calendar, and conflict checks support guests.
-- One-time walk-in appointments have no customer row or LINE claim.
ALTER TABLE public.appointments
  ADD COLUMN IF NOT EXISTS booking_origin text NOT NULL DEFAULT 'CUSTOMER',
  ADD COLUMN IF NOT EXISTS guest_contact_phone text;
ALTER TABLE public.appointments
  ALTER COLUMN customer_id DROP NOT NULL;
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
-- Existing RLS policies must remain unchanged. Guest creation must use a
-- staff-authenticated, tenant-scoped transaction with conflict protection.
