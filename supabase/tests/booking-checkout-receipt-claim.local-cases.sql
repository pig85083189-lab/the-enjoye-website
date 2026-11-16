-- Receipt claim cases. Local booking database only. No wallet debit.
do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_status text;
begin
  perform set_config('tests.uid', '99999999-9999-4999-8999-999999999999', true);
  perform tests.open_draft('claim-pending', 250, 0);
  perform public.save_checkout_draft(
    'claim-pending', tests.draft_updated_at('claim-pending'),
    '[{"method":"STORED_VALUE","amount":250}]'::jsonb, '[]'::jsonb
  );
  v_status := public.claim_stored_value_debit_receipt(
    v_org, 'claim-pending', 'src-compat-0001', 250, 'booking-checkout:claim-pending'
  );
  if v_status <> 'PENDING' then
    raise exception 'claim did not start at PENDING';
  end if;
  begin
    perform public.settle_checkout_draft('claim-pending', tests.draft_updated_at('claim-pending'));
    raise exception 'pending receipt settled a stored-value checkout';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then raise; end if;
  end;
  if (select status from public.checkout_drafts where app_id = 'claim-pending') <> 'OPEN' then
    raise exception 'pending receipt completed the booking draft';
  end if;

  v_status := public.claim_stored_value_debit_receipt(
    v_org, 'claim-pending', 'src-compat-0001', 250, 'booking-checkout:claim-pending'
  );
  if v_status <> 'PENDING'
     or (select count(*) from public.stored_value_debit_receipts where checkout_app_id = 'claim-pending') <> 1 then
    raise exception 'repeated claim created another receipt';
  end if;
  begin
    perform public.claim_stored_value_debit_receipt(
      v_org, 'claim-pending', 'src-compat-0001', 251, 'booking-checkout:claim-pending'
    );
    raise exception 'claim accepted a different amount';
  exception
    when others then
      if sqlerrm <> '儲值金收據與結帳不一致' then raise; end if;
  end;

  perform tests.open_draft('claim-effect', 250, 0);
  perform public.save_checkout_draft(
    'claim-effect', tests.draft_updated_at('claim-effect'),
    '[{"method":"STORED_VALUE","amount":250}]'::jsonb, '[]'::jsonb
  );
  insert into public.stored_value_debit_receipts (
    organization_id, checkout_app_id, source_customer_key, amount_minor, effect_key, status
  ) values (
    v_org, 'claim-effect', 'src-compat-0001', 250, 'booking-checkout:other', 'POSTED'
  );
  begin
    perform public.settle_checkout_draft('claim-effect', tests.draft_updated_at('claim-effect'));
    raise exception 'receipt with a different effect key settled checkout';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then raise; end if;
  end;

  if public.commit_stored_value_debit_receipt(
       v_org, 'claim-pending', 'src-compat-0001', 250, 'booking-checkout:claim-pending'
     ) <> 'POSTED' then
    raise exception 'commit did not post the pending receipt';
  end if;
  if public.commit_stored_value_debit_receipt(
       v_org, 'claim-pending', 'src-compat-0001', 250, 'booking-checkout:claim-pending'
     ) <> 'POSTED'
     or (select count(*) from public.stored_value_debit_receipts where checkout_app_id = 'claim-pending' and status = 'POSTED') <> 1 then
    raise exception 'repeated commit changed the posted receipt';
  end if;
  begin
    perform public.abandon_stored_value_debit_receipt(
      v_org, 'claim-pending', 'src-compat-0001', 250, 'booking-checkout:claim-pending'
    );
    raise exception 'posted receipt was abandoned';
  exception
    when others then
      if sqlerrm <> '儲值金收據已入帳，不能改為失敗' then raise; end if;
  end;
  perform public.settle_checkout_draft('claim-pending', tests.draft_updated_at('claim-pending'));
  if (select count(*) from public.transactions t
        join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'claim-pending') <> 1 then
    raise exception 'posted receipt did not settle exactly once';
  end if;

  perform public.claim_stored_value_debit_receipt(
    v_org, 'claim-failed', 'src-compat-0001', 80, 'booking-checkout:claim-failed'
  );
  if public.abandon_stored_value_debit_receipt(
       v_org, 'claim-failed', 'src-compat-0001', 80, 'booking-checkout:claim-failed'
     ) <> 'FAILED' then
    raise exception 'definite rejection did not fail the receipt';
  end if;
  if public.claim_stored_value_debit_receipt(
       v_org, 'claim-failed', 'src-compat-0001', 80, 'booking-checkout:claim-failed'
     ) <> 'PENDING' then
    raise exception 'failed receipt could not be claimed again';
  end if;
end $$;

do $$
begin
  if not has_function_privilege('service_role', 'public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'execute')
     or not has_function_privilege('service_role', 'public.commit_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'execute')
     or not has_function_privilege('service_role', 'public.abandon_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'execute')
     or has_function_privilege('authenticated', 'public.claim_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'execute')
     or has_function_privilege('anon', 'public.commit_stored_value_debit_receipt(uuid,text,text,bigint,text)', 'execute')
     or has_table_privilege('authenticated', 'public.stored_value_debit_receipts', 'update')
     or not has_table_privilege('service_role', 'public.stored_value_debit_receipts', 'update') then
    raise exception 'receipt claim grants are not limited to service_role';
  end if;
end $$;
