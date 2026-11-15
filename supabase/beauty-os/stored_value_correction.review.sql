-- Draft only: additive correction RPC; do not deploy until UI and integration tests pass.
CREATE OR REPLACE FUNCTION public.correct_stored_value_top_up(
  p_entry_id uuid,
  p_corrected_amount_minor bigint,
  p_effect_key text
) RETURNS TABLE(correction_entry_id uuid, balance_minor bigint, was_duplicate boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  v_original public.stored_value_ledger_entries%ROWTYPE;
  v_account public.stored_value_accounts%ROWTYPE;
  v_staff text;
  v_existing public.stored_value_ledger_entries%ROWTYPE;
  v_previous_delta bigint;
  v_delta bigint;
  v_balance bigint;
  v_new_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION '沒有權限更正儲值'; END IF;
  IF p_corrected_amount_minor IS NULL OR p_corrected_amount_minor <= 0 OR p_corrected_amount_minor > 100000000 THEN
    RAISE EXCEPTION '更正金額無效';
  END IF;
  IF p_effect_key IS NULL OR length(trim(p_effect_key)) < 16 OR length(p_effect_key) > 180 THEN
    RAISE EXCEPTION '更正識別碼無效';
  END IF;
  SELECT * INTO v_original FROM public.stored_value_ledger_entries
   WHERE id=p_entry_id AND type='TOP_UP';
  IF NOT FOUND THEN RAISE EXCEPTION '找不到原始儲值紀錄'; END IF;
  v_staff := public.assert_commerce_checkout_actor(v_original.organization_id,v_original.location_id);
  PERFORM 1 FROM public.customers
   WHERE id=v_original.customer_id AND organization_id=v_original.organization_id AND status='ACTIVE'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '顧客狀態無效'; END IF;
  SELECT * INTO v_account FROM public.stored_value_accounts
   WHERE id=v_original.account_id AND organization_id=v_original.organization_id
     AND customer_id=v_original.customer_id AND status='ACTIVE' AND currency='TWD'
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION '儲值帳戶狀態無效'; END IF;
  SELECT * INTO v_existing FROM public.stored_value_ledger_entries
   WHERE organization_id=v_original.organization_id AND effect_key=p_effect_key;
  IF FOUND THEN
    IF v_existing.type <> 'ADJUSTMENT' OR v_existing.reverses_entry_id IS DISTINCT FROM v_original.id
       OR v_existing.reason IS DISTINCT FROM ('TOP_UP_CORRECTION:' || p_corrected_amount_minor::text) THEN
      RAISE EXCEPTION '更正識別碼衝突';
    END IF;
    SELECT coalesce(sum(amount_delta_minor),0) INTO v_balance
      FROM public.stored_value_ledger_entries WHERE account_id=v_account.id;
    RETURN QUERY SELECT v_existing.id,v_balance,true;
    RETURN;
  END IF;
  SELECT coalesce(sum(amount_delta_minor),0) INTO v_previous_delta
    FROM public.stored_value_ledger_entries
    WHERE account_id=v_account.id AND type='ADJUSTMENT' AND reverses_entry_id=v_original.id
      AND reason LIKE 'TOP_UP_CORRECTION:%';
  v_delta := p_corrected_amount_minor - (v_original.amount_delta_minor + v_previous_delta);
  SELECT coalesce(sum(amount_delta_minor),0) INTO v_balance
    FROM public.stored_value_ledger_entries WHERE account_id=v_account.id;
  IF v_balance + v_delta < 0 THEN RAISE EXCEPTION '更正後餘額不足，請先核對已使用金額'; END IF;
  IF v_delta = 0 THEN RAISE EXCEPTION '金額未變更'; END IF;
  INSERT INTO public.stored_value_ledger_entries
   (organization_id,account_id,customer_id,type,amount_delta_minor,
    location_id,created_by_staff_id,effect_key,reason,reverses_entry_id)
  VALUES
   (v_original.organization_id,v_account.id,v_original.customer_id,'ADJUSTMENT',v_delta,
    v_original.location_id,v_staff,p_effect_key,
    'TOP_UP_CORRECTION:' || p_corrected_amount_minor::text,v_original.id)
  RETURNING id INTO v_new_id;
  RETURN QUERY SELECT v_new_id,v_balance+v_delta,false;
END;
$fn$;
REVOKE ALL ON FUNCTION public.correct_stored_value_top_up(uuid,bigint,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.correct_stored_value_top_up(uuid,bigint,text) TO authenticated;
