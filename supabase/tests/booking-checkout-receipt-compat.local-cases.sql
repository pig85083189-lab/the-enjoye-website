-- Isolated booking receipt compatibility cases. No production data.
insert into public.organizations (id)
values ('11111111-1111-4111-8111-111111111111');

insert into public.customers (id, organization_id, status)
values ('33333333-3333-4333-8333-333333333333', '11111111-1111-4111-8111-111111111111', 'ACTIVE');

insert into public.locations (id, organization_id)
values ('22222222-2222-4222-8222-222222222222', '11111111-1111-4111-8111-111111111111');

insert into public.customer_packages (
  organization_id, customer_id, app_id, status, included_service_ids_snapshot
) values (
  '11111111-1111-4111-8111-111111111111',
  '33333333-3333-4333-8333-333333333333',
  'cpkg-compat-0001',
  'ACTIVE',
  array['svc-compat-0001']
);

do $$
declare
  v_uid text := '99999999-9999-4999-8999-999999999999';
  v_at timestamptz;
  v_redemption jsonb := jsonb_build_object(
    'customerPackageId', 'cpkg-compat-0001',
    'serviceId', 'svc-compat-0001',
    'sessions', 1
  );
  v_tx uuid;
begin
  if (select count(*) from pg_proc where proname = 'save_checkout_draft') <> 2 then
    raise exception 'save_checkout_draft must keep the four-argument and five-argument versions';
  end if;
  if pg_get_functiondef('public.save_checkout_draft(text,timestamptz,jsonb,jsonb)'::regprocedure)
       not like '%package_redemption%' then
    raise exception 'four-argument save no longer forwards package redemption';
  end if;
  if pg_get_functiondef('public.settle_checkout_draft(text,timestamptz)'::regprocedure)
       not like '%v_draft.package_redemption%'
     or pg_get_functiondef('public.settle_checkout_draft(text,timestamptz)'::regprocedure)
       not like '%apply_package_effects_for_transaction%'
     or pg_get_functiondef('public.settle_checkout_draft(text,timestamptz)'::regprocedure)
       like '%stored_value_ledger_entries%' then
    raise exception 'settle no longer preserves package checkout or it writes a ledger';
  end if;

  perform set_config('tests.uid', '', false);
  perform tests.open_draft('cash-unauth', 100, 0);
  begin
    perform public.save_checkout_draft(
      'cash-unauth', tests.draft_updated_at('cash-unauth'),
      '[{"method":"CASH","amount":100}]'::jsonb, '[]'::jsonb
    );
    raise exception 'unauthenticated save was accepted';
  exception
    when others then
      if sqlerrm <> '沒有權限結帳' then
        raise;
      end if;
  end;

  perform set_config('tests.uid', v_uid, false);

  perform tests.open_draft('cash-discount', 800, 0);
  perform public.save_checkout_draft(
    'cash-discount', tests.draft_updated_at('cash-discount'),
    '[{"method":"CASH","amount":700}]'::jsonb,
    '[{"type":"ORDER_FIXED","value":100,"label":"折扣","reason":"隔離"}]'::jsonb
  );
  perform public.settle_checkout_draft('cash-discount', tests.draft_updated_at('cash-discount'));
  select t.id into v_tx from public.transactions t
    join public.checkout_drafts d on d.id = t.checkout_draft_id
   where d.app_id = 'cash-discount';
  if v_tx is null
     or (select total_minor from public.transactions where id = v_tx) <> 700
     or (select discount_total_minor from public.transactions where id = v_tx) <> 100
     or (select package_redemption from public.transactions where id = v_tx) is not null
     or (select count(*) from public.transaction_payments where transaction_id = v_tx and method = 'CASH' and amount_minor = 700) <> 1
     or (select count(*) from public.transaction_discounts where transaction_id = v_tx and amount_applied_minor = 100) <> 1
     or (select count(*) from public.transaction_items where transaction_id = v_tx) <> 1
     or (select count(*) from tests.package_effects where transaction_id = v_tx) <> 1 then
    raise exception 'cash checkout did not keep the discount, payment, or line item';
  end if;

  perform tests.open_draft('package-keep', 800, 0);
  perform public.save_checkout_draft(
    'package-keep', tests.draft_updated_at('package-keep'),
    '[]'::jsonb, '[]'::jsonb, v_redemption
  );
  if (select package_redemption from public.checkout_drafts where app_id = 'package-keep') <> v_redemption
     or (select line_total_minor from public.checkout_items where app_id = 'package-keep-svc') <> 0 then
    raise exception 'five-argument save did not store the package redemption';
  end if;
  perform public.save_checkout_draft(
    'package-keep', tests.draft_updated_at('package-keep'),
    '[{"method":"CASH","amount":1}]'::jsonb, '[]'::jsonb
  );
  if (select package_redemption from public.checkout_drafts where app_id = 'package-keep') <> v_redemption then
    raise exception 'four-argument save cleared the package redemption';
  end if;
  perform public.save_checkout_draft(
    'package-keep', tests.draft_updated_at('package-keep'),
    '[]'::jsonb, '[]'::jsonb
  );
  perform public.settle_checkout_draft('package-keep', tests.draft_updated_at('package-keep'));
  select t.id into v_tx from public.transactions t
    join public.checkout_drafts d on d.id = t.checkout_draft_id
   where d.app_id = 'package-keep';
  if (select package_redemption from public.transactions where id = v_tx) <> v_redemption
     or (select total_minor from public.transactions where id = v_tx) <> 0
     or exists (select 1 from public.transaction_payments where transaction_id = v_tx)
     or (select line_total_minor from public.transaction_items where transaction_id = v_tx) <> 0
     or (select package_redemption from tests.package_effects where transaction_id = v_tx) <> v_redemption then
    raise exception 'package settle did not copy the redemption or apply package effects';
  end if;
  perform public.settle_checkout_draft('package-keep', tests.draft_updated_at('package-keep'));
  if (select count(*) from public.transactions t
        join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'package-keep') <> 1
     or (select count(*) from tests.package_effects where transaction_id = v_tx) <> 1 then
    raise exception 'duplicate package settle created another transaction or package effect';
  end if;

  perform tests.open_draft('package-clear', 800, 0);
  perform public.save_checkout_draft(
    'package-clear', tests.draft_updated_at('package-clear'),
    '[]'::jsonb, '[]'::jsonb, v_redemption
  );
  perform public.save_checkout_draft(
    'package-clear', tests.draft_updated_at('package-clear'),
    '[{"method":"CASH","amount":800}]'::jsonb, '[]'::jsonb, null
  );
  if (select package_redemption from public.checkout_drafts where app_id = 'package-clear') is not null
     or (select line_total_minor from public.checkout_items where app_id = 'package-clear-svc') <> 800 then
    raise exception 'five-argument save did not clear the package redemption';
  end if;

  perform tests.open_draft('package-method', 800, 0);
  begin
    perform public.save_checkout_draft(
      'package-method', tests.draft_updated_at('package-method'),
      '[{"method":"PACKAGE","amount":800}]'::jsonb, '[]'::jsonb, null
    );
    raise exception 'package payment method was saved';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then
        raise;
      end if;
  end;
  begin
    perform public.save_checkout_draft(
      'package-method', tests.draft_updated_at('package-method'),
      '[{"method":"PACKAGE","amount":800}]'::jsonb, '[]'::jsonb
    );
    raise exception 'four-argument save accepted a package payment';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then
        raise;
      end if;
  end;

  perform tests.open_draft('stored-blocked', 800, 0);
  perform public.save_checkout_draft(
    'stored-blocked', tests.draft_updated_at('stored-blocked'),
    '[{"method":"STORED_VALUE","amount":800}]'::jsonb, '[]'::jsonb
  );
  insert into public.stored_value_debit_receipts (
    organization_id, checkout_app_id, source_customer_key, amount_minor, effect_key, status
  ) values (
    '22222222-2222-4222-8222-222222222222', 'stored-blocked', 'src-compat-0001', 800, 'wrong-org', 'POSTED'
  );
  begin
    perform public.settle_checkout_draft('stored-blocked', tests.draft_updated_at('stored-blocked'));
    raise exception 'stored value settled with a receipt from another organization';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then
        raise;
      end if;
  end;
  if exists (
    select 1 from public.transactions t
    join public.checkout_drafts d on d.id = t.checkout_draft_id
    where d.app_id = 'stored-blocked'
  ) or (select status from public.checkout_drafts where app_id = 'stored-blocked') <> 'OPEN' then
    raise exception 'rejected stored-value settle left a transaction or completed the draft';
  end if;

  perform tests.open_draft('stored-package', 800, 300);
  perform public.save_checkout_draft(
    'stored-package', tests.draft_updated_at('stored-package'),
    '[{"method":"STORED_VALUE","amount":300}]'::jsonb, '[]'::jsonb, v_redemption
  );
  begin
    perform public.settle_checkout_draft('stored-package', tests.draft_updated_at('stored-package'));
    raise exception 'stored value settled without a finance receipt';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then
        raise;
      end if;
  end;
  insert into public.stored_value_debit_receipts (
    organization_id, checkout_app_id, source_customer_key, amount_minor, effect_key, status
  ) values (
    '11111111-1111-4111-8111-111111111111', 'stored-package', 'src-compat-0001', 299, 'booking-checkout:stored-package', 'POSTED'
  );
  begin
    perform public.settle_checkout_draft('stored-package', tests.draft_updated_at('stored-package'));
    raise exception 'stored value settled with a receipt amount that does not match';
  exception
    when others then
      if sqlerrm <> '此付款方式目前尚未開放' then
        raise;
      end if;
  end;
  update public.stored_value_debit_receipts
     set amount_minor = 300
   where checkout_app_id = 'stored-package';
  perform public.settle_checkout_draft('stored-package', tests.draft_updated_at('stored-package'));
  select t.id into v_tx from public.transactions t
    join public.checkout_drafts d on d.id = t.checkout_draft_id
   where d.app_id = 'stored-package';
  if (select package_redemption from public.transactions where id = v_tx) <> v_redemption
     or (select total_minor from public.transactions where id = v_tx) <> 300
     or (select count(*) from public.transaction_payments where transaction_id = v_tx and method = 'STORED_VALUE' and amount_minor = 300) <> 1
     or (select line_total_minor from public.transaction_items where transaction_id = v_tx and type = 'SERVICE') <> 0
     or (select line_total_minor from public.transaction_items where transaction_id = v_tx and type = 'PRODUCT') <> 300
     or (select count(*) from tests.package_effects where transaction_id = v_tx) <> 1 then
    raise exception 'stored-value settle did not keep the package redemption and receipt amount';
  end if;
  perform public.settle_checkout_draft('stored-package', tests.draft_updated_at('stored-package'));
  if (select count(*) from public.transactions t
        join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'stored-package') <> 1 then
    raise exception 'duplicate stored-value settle created another transaction';
  end if;

  perform tests.open_draft('rollback-sale', 500, 0);
  perform public.save_checkout_draft(
    'rollback-sale', tests.draft_updated_at('rollback-sale'),
    '[{"method":"CASH","amount":500}]'::jsonb, '[]'::jsonb
  );
  update tests.controls set fail_package = true;
  begin
    perform public.settle_checkout_draft('rollback-sale', tests.draft_updated_at('rollback-sale'));
    raise exception 'package failure did not roll the sale back';
  exception
    when others then
      if position('套票回滾測試' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  update tests.controls set fail_package = false;
  if exists (
       select 1 from public.transactions t
       join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'rollback-sale'
     )
     or (select status from public.checkout_drafts where app_id = 'rollback-sale') <> 'OPEN'
     or exists (select 1 from tests.package_effects e
                join public.transactions t on t.id = e.transaction_id
                join public.checkout_drafts d on d.id = t.checkout_draft_id
                where d.app_id = 'rollback-sale') then
    raise exception 'failed settle left a transaction, package effect, or completed draft';
  end if;
  perform public.settle_checkout_draft('rollback-sale', tests.draft_updated_at('rollback-sale'));
  if (select count(*) from public.transactions t
        join public.checkout_drafts d on d.id = t.checkout_draft_id
       where d.app_id = 'rollback-sale' and t.total_minor = 500) <> 1 then
    raise exception 'cash settle did not complete after the failed attempt rolled back';
  end if;
end $$;

do $$
begin
  set local role authenticated;
  insert into public.stored_value_debit_receipts (
    organization_id, checkout_app_id, source_customer_key, amount_minor, effect_key, status
  ) values (
    '11111111-1111-4111-8111-111111111111', 'auth-insert', 'src-compat-0001', 100, 'auth-insert', 'POSTED'
  );
  raise exception 'authenticated inserted a stored-value receipt';
exception
  when insufficient_privilege then
    null;
end $$;

do $$
declare
  v_at timestamptz;
begin
  perform tests.open_draft('cash-auth', 400, 0);
  perform set_config('tests.uid', '99999999-9999-4999-8999-999999999999', true);
  v_at := tests.draft_updated_at('cash-auth');
  set local role authenticated;
  perform public.save_checkout_draft(
    'cash-auth', v_at, '[{"method":"CASH","amount":400}]'::jsonb, '[]'::jsonb
  );
  v_at := tests.draft_updated_at('cash-auth');
  perform public.settle_checkout_draft('cash-auth', v_at);
end $$;

do $$
begin
  if (select status from public.checkout_drafts where app_id = 'cash-auth') <> 'COMPLETED' then
    raise exception 'authenticated staff could not complete a cash checkout';
  end if;
  if not has_table_privilege('service_role', 'public.stored_value_debit_receipts', 'insert')
     or has_table_privilege('authenticated', 'public.stored_value_debit_receipts', 'insert')
     or has_table_privilege('anon', 'public.stored_value_debit_receipts', 'insert') then
    raise exception 'stored-value receipt grants do not match the service-role insert path';
  end if;
  if not has_function_privilege('authenticated', 'public.save_checkout_draft(text,timestamptz,jsonb,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.save_checkout_draft(text,timestamptz,jsonb,jsonb,jsonb)', 'execute')
     or not has_function_privilege('authenticated', 'public.settle_checkout_draft(text,timestamptz)', 'execute')
     or has_function_privilege('anon', 'public.settle_checkout_draft(text,timestamptz)', 'execute') then
    raise exception 'booking checkout grants no longer match the staff session path';
  end if;
  if to_regclass('public.stored_value_ledger_entries') is not null then
    raise exception 'booking checkout migration created a stored-value ledger';
  end if;
end $$;
