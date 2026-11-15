-- Non-persistent security smoke test for stored-value correction.
-- Run against the intended database with a privileged migration/test connection.
BEGIN;
DO $test$
DECLARE v_denied boolean := false;
BEGIN
  BEGIN
    PERFORM * FROM public.correct_stored_value_top_up(gen_random_uuid(), 100, 'wallet-correction-test-unauthenticated');
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM = '沒有權限更正儲值' THEN v_denied := true; ELSE RAISE; END IF;
  END;
  IF NOT v_denied THEN RAISE EXCEPTION 'Unauthenticated correction was not rejected'; END IF;
END;
$test$;
ROLLBACK;
-- This test does NOT verify authorized correction, concurrent updates, or UI integration.
