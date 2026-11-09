-- Self-service leave preflight, read-only. Run separately on TEST and Production.
-- This intentionally fails if the two environments do not support the same
-- booking time-off contract. Do not release the new UI until it passes.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(required.column_name, ', ')
    INTO missing
  FROM (VALUES
    ('booking_staff_time_off','organization_id'),
    ('booking_staff_time_off','location_id'),
    ('booking_staff_time_off','staff_id'),
    ('booking_staff_time_off','start_at'),
    ('booking_staff_time_off','end_at'),
    ('booking_staff_time_off','status'),
    ('staff_leave_requests','staff_membership_id'),
    ('staff_leave_requests','starts_at'),
    ('staff_leave_requests','ends_at'),
    ('staff_leave_requests','status'),
    ('appointments','staff_id'),
    ('appointments','starts_at'),
    ('appointments','ends_at'),
    ('appointments','status')
  ) AS required(table_name,column_name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema='public'
      AND c.table_name=required.table_name
      AND c.column_name=required.column_name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'SELF_SERVICE_LEAVE_SCHEMA_NOT_READY: %',missing;
  END IF;
END $$;

-- A-mode acceptance requirements (all staff may take the same date off):
-- 1. Each authenticated employee may create/cancel ONLY their own leave.
-- 2. Write leave + booking unavailability in ONE database transaction.
-- 3. Reject any day with a non-cancelled overlapping appointment.
-- 4. Booking availability must read the exact same unavailability source.
-- 5. No minimum-on-duty check; zero available staff means zero slots.
-- 6. Preserve legacy pending rows until a separate, explicit conversion.
-- 7. Verify race conditions, repeated submissions, and cancellation rollback.
