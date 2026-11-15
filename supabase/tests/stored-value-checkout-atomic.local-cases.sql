-- Local-only stored-value checkout cases. Never run against Beauty OS production.
-- Mirrors THE ENJOYE Member wallet read: type + amount_delta_minor for one customer.

create or replace function tests.balance(p_customer uuid)
returns bigint
language sql
stable
as $$
  select coalesce(sum(amount_delta_minor), 0)
  from public.stored_value_ledger_entries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and customer_id = p_customer;
$$;

create or replace function tests.member_payments(p_customer uuid)
returns bigint
language sql
stable
as $$
  select count(*)
  from public.stored_value_ledger_entries
  where organization_id = '11111111-1111-4111-8111-111111111111'
    and customer_id = p_customer
    and type = 'PAYMENT';
$$;

create or replace function tests.open_sale(
  p_app text,
  p_customer uuid,
  p_appointment uuid,
  p_treatment uuid,
  p_total bigint,
  p_currency text default 'TWD'
) returns void
language plpgsql
as $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_loc uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_draft uuid := gen_random_uuid();
begin
  insert into public.appointments (id, organization_id, status)
  values (p_appointment, v_org, 'COMPLETED');
  insert into public.treatments (id, organization_id, status)
  values (p_treatment, v_org, 'COMPLETED');
  insert into public.checkout_drafts (
    organization_id, location_id, customer_id, appointment_id, treatment_id, app_id,
    subtotal_minor, discount_total_minor, total_minor, currency, status,
    created_by_staff_id, updated_at, id
  ) values (
    v_org, v_loc, p_customer, p_appointment, p_treatment, p_app,
    p_total, 0, p_total, p_currency, 'OPEN',
    'staff-test-1', timestamptz '2026-11-15 00:00:00+00', v_draft
  );
  insert into public.checkout_items (
    organization_id, checkout_draft_id, app_id, type, name_snapshot,
    unit_price_minor, quantity, line_subtotal_minor, discount_amount_minor,
    line_total_minor, sort_order
  ) values (
    v_org, v_draft, p_app || '-item', 'SERVICE', '隔離測試服務',
    p_total, 1, p_total, 0, p_total, 0
  );
end;
$$;

create or replace function tests.pay(
  p_app text,
  p_method public.payment_method,
  p_amount bigint,
  p_note text default null
) returns void
language plpgsql
as $$
declare
  v_draft uuid;
begin
  select id into v_draft from public.checkout_drafts where app_id = p_app;
  insert into public.checkout_payments (
    organization_id, checkout_draft_id, app_id, method, amount_minor, note
  ) values (
    '11111111-1111-4111-8111-111111111111',
    v_draft,
    p_app || '-' || p_method::text || '-' || p_amount::text,
    p_method,
    p_amount,
    p_note
  );
end;
$$;

create or replace function tests.wallet(
  p_customer uuid,
  p_balance bigint,
  p_status text default 'ACTIVE'
) returns void
language plpgsql
as $$
declare
  v_account uuid;
begin
  insert into public.stored_value_accounts (organization_id, customer_id, currency, status)
  values ('11111111-1111-4111-8111-111111111111', p_customer, 'TWD', p_status)
  returning id into v_account;
  if p_balance <> 0 then
    insert into public.stored_value_ledger_entries (
      organization_id, account_id, customer_id, type, amount_delta_minor,
      reason, effect_key, created_by_staff_id
    ) values (
      '11111111-1111-4111-8111-111111111111', v_account, p_customer, 'TOP_UP', p_balance,
      'ISOLATED_TEST_SEED', 'seed:' || p_customer::text, 'staff-test-1'
    );
  end if;
end;
$$;

do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_bound uuid := '22222222-2222-4222-8222-222222222222';
  v_unbound uuid := '33333333-3333-4333-8333-333333333333';
  v_legacy uuid := '44444444-4444-4444-8444-444444444444';
  v_low uuid := '55555555-5555-4555-8555-555555555555';
  v_missing uuid := '66666666-6666-4666-8666-666666666666';
  v_when timestamptz := timestamptz '2026-11-15 00:00:00+00';
  v_tx_count int;
  v_pay_count int;
begin
  perform set_config('tests.uid', '99999999-9999-4999-8999-999999999999', true);
  insert into public.customers (id, organization_id, status) values
    (v_bound, v_org, 'ACTIVE'),
    (v_unbound, v_org, 'ACTIVE'),
    (v_legacy, v_org, 'ACTIVE'),
    (v_low, v_org, 'ACTIVE'),
    (v_missing, v_org, 'ACTIVE');
  insert into public.member_line_customer_links (organization_id, customer_id, verified_at)
  values (v_org, v_bound, now()), (v_org, v_low, now()), (v_org, v_missing, now());
  insert into public.line_customer_bindings (
    organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
  ) values (
    'org-stored-value-test', v_legacy, 'active', true, now(), now(), repeat('ab', 32)
  );
  perform tests.wallet(v_bound, 1000);
  perform tests.wallet(v_legacy, 1000);
  perform tests.wallet(v_low, 500);
  perform tests.wallet(v_unbound, 1000);

  -- Cash checkout for a customer without LINE binding still settles and does not touch the wallet.
  perform tests.open_sale('sale-cash', v_unbound, 'a1000000-0000-4000-8000-000000000001', 'b1000000-0000-4000-8000-000000000001', 800);
  perform tests.pay('sale-cash', 'CASH', 800);
  perform public.settle_checkout_draft('sale-cash', v_when);
  if tests.balance(v_unbound) <> 1000 then
    raise exception 'cash checkout changed stored value';
  end if;
  if tests.member_payments(v_unbound) <> 0 then
    raise exception 'cash checkout wrote a member payment row';
  end if;

  -- Full stored-value payment.
  perform tests.open_sale('sale-full', v_bound, 'a1000000-0000-4000-8000-000000000002', 'b1000000-0000-4000-8000-000000000002', 800);
  perform tests.pay('sale-full', 'STORED_VALUE', 800);
  perform public.settle_checkout_draft('sale-full', v_when);
  if tests.balance(v_bound) <> 200 then
    raise exception 'full payment balance %', tests.balance(v_bound);
  end if;
  if tests.member_payments(v_bound) <> 1 then
    raise exception 'member history missing PAYMENT';
  end if;
  if not exists (
    select 1 from public.stored_value_ledger_entries
    where customer_id = v_bound and type = 'PAYMENT' and amount_delta_minor = -800
      and effect_key = 'checkout:' || (select id::text from public.checkout_drafts where app_id = 'sale-full')
  ) then
    raise exception 'member payment delta mismatch';
  end if;

  -- Same checkout submitted again, including the stale updated_at from the first click.
  perform public.settle_checkout_draft('sale-full', v_when);
  select count(*) into v_tx_count from public.transactions where customer_id = v_bound;
  if v_tx_count <> 1 or tests.balance(v_bound) <> 200 or tests.member_payments(v_bound) <> 1 then
    raise exception 'duplicate settle double-charged';
  end if;

  -- Mixed tender debits only the stored-value portion.
  perform tests.open_sale('sale-mixed', v_legacy, 'a1000000-0000-4000-8000-000000000003', 'b1000000-0000-4000-8000-000000000003', 800);
  perform tests.pay('sale-mixed', 'CASH', 300);
  perform tests.pay('sale-mixed', 'STORED_VALUE', 500);
  perform public.settle_checkout_draft('sale-mixed', v_when);
  if tests.balance(v_legacy) <> 500 or tests.member_payments(v_legacy) <> 1 then
    raise exception 'mixed payment balance %', tests.balance(v_legacy);
  end if;
  if (
    select amount_delta_minor from public.stored_value_ledger_entries
    where customer_id = v_legacy and type = 'PAYMENT'
  ) <> -500 then
    raise exception 'mixed payment debited the wrong amount';
  end if;
end;
$$;

do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_legacy uuid := '44444444-4444-4444-8444-444444444444';
  v_low uuid := '55555555-5555-4555-8555-555555555555';
  v_missing uuid := '66666666-6666-4666-8666-666666666666';
  v_plain uuid := '77777777-7777-4777-8777-777777777777';
  v_when timestamptz := timestamptz '2026-11-15 00:00:00+00';
  v_balance bigint;
begin
  perform set_config('tests.uid', '99999999-9999-4999-8999-999999999999', true);

  insert into public.customers (id, organization_id, status)
  values (v_plain, v_org, 'ACTIVE')
  on conflict (id) do nothing;
  insert into public.member_line_customer_links (organization_id, customer_id, verified_at)
  values (v_org, v_plain, now())
  on conflict (organization_id, customer_id) do nothing;
  perform tests.wallet(v_plain, 1000);

  perform tests.open_sale('sale-conflict', v_legacy, 'a1000000-0000-4000-8000-000000000004', 'b1000000-0000-4000-8000-000000000004', 100);
  perform tests.pay('sale-conflict', 'STORED_VALUE', 100);
  update public.checkout_drafts
  set appointment_id = 'a1000000-0000-4000-8000-000000000003'
  where app_id = 'sale-conflict';
  begin
    perform public.settle_checkout_draft('sale-conflict', v_when);
    raise exception 'appointment conflict was accepted';
  exception
    when others then
      if position('此預約已有其他結帳交易' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  if tests.balance(v_legacy) <> 500 then
    raise exception 'appointment conflict debited stored value';
  end if;
  if exists (select 1 from public.transactions t join public.checkout_drafts d on d.id = t.checkout_draft_id where d.app_id = 'sale-conflict') then
    raise exception 'appointment conflict created a transaction';
  end if;

  perform tests.open_sale('sale-low', v_low, 'a1000000-0000-4000-8000-000000000005', 'b1000000-0000-4000-8000-000000000005', 800);
  perform tests.pay('sale-low', 'STORED_VALUE', 800);
  begin
    perform public.settle_checkout_draft('sale-low', v_when);
    raise exception 'insufficient balance was accepted';
  exception
    when others then
      if position('儲值金餘額不足' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  if tests.balance(v_low) <> 500 or tests.member_payments(v_low) <> 0 then
    raise exception 'insufficient balance was not rolled back';
  end if;
  if (select status from public.checkout_drafts where app_id = 'sale-low') <> 'OPEN' then
    raise exception 'insufficient balance closed the draft';
  end if;

  perform tests.open_sale('sale-unbound', '33333333-3333-4333-8333-333333333333', 'a1000000-0000-4000-8000-000000000006', 'b1000000-0000-4000-8000-000000000006', 100);
  perform tests.pay('sale-unbound', 'STORED_VALUE', 100);
  begin
    perform public.settle_checkout_draft('sale-unbound', v_when);
    raise exception 'unbound customer was accepted';
  exception
    when others then
      if position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  if tests.member_payments('33333333-3333-4333-8333-333333333333') <> 0 then
    raise exception 'unbound customer was debited';
  end if;

  perform tests.open_sale('sale-missing', v_missing, 'a1000000-0000-4000-8000-000000000007', 'b1000000-0000-4000-8000-000000000007', 100);
  perform tests.pay('sale-missing', 'STORED_VALUE', 100);
  begin
    perform public.settle_checkout_draft('sale-missing', v_when);
    raise exception 'missing wallet was accepted';
  exception
    when others then
      if position('找不到有效儲值帳戶' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  perform tests.open_sale('sale-usd', v_plain, 'a1000000-0000-4000-8000-000000000008', 'b1000000-0000-4000-8000-000000000008', 100, 'USD');
  perform tests.pay('sale-usd', 'STORED_VALUE', 100);
  begin
    perform public.settle_checkout_draft('sale-usd', v_when);
    raise exception 'non-TWD wallet checkout was accepted';
  exception
    when others then
      if position('儲值金僅支援 TWD' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  if tests.balance(v_plain) <> 1000 then
    raise exception 'rejected currency checkout changed the balance';
  end if;

  perform tests.open_sale('sale-rollback', v_plain, 'a1000000-0000-4000-8000-000000000009', 'b1000000-0000-4000-8000-000000000009', 100);
  perform tests.pay('sale-rollback', 'STORED_VALUE', 100, 'FORCE_ROLLBACK');
  begin
    perform public.settle_checkout_draft('sale-rollback', v_when);
    raise exception 'forced payment failure was accepted';
  exception
    when others then
      if position('forced_payment_failure' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  v_balance := tests.balance(v_plain);
  if v_balance <> 1000 or tests.member_payments(v_plain) <> 0 then
    raise exception 'failed checkout did not roll back the debit, balance %', v_balance;
  end if;
  if exists (
    select 1 from public.transactions t
    join public.checkout_drafts d on d.id = t.checkout_draft_id
    where d.app_id = 'sale-rollback'
  ) or (select status from public.checkout_drafts where app_id = 'sale-rollback') <> 'OPEN' then
    raise exception 'failed checkout left a transaction or closed the draft';
  end if;

  begin
    perform public.save_checkout_draft(
      'sale-rollback',
      (select updated_at from public.checkout_drafts where app_id = 'sale-rollback'),
      jsonb_build_array(jsonb_build_object('id', 'pay-zero', 'method', 'STORED_VALUE', 'amount', 0)),
      '[]'::jsonb
    );
    raise exception 'zero stored-value amount was accepted';
  exception
    when others then
      if position('付款金額不可為 0' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  begin
    perform public.save_checkout_draft(
      'sale-rollback',
      (select updated_at from public.checkout_drafts where app_id = 'sale-rollback'),
      jsonb_build_array(jsonb_build_object('id', 'pay-package', 'method', 'PACKAGE', 'amount', 100)),
      '[]'::jsonb
    );
    raise exception 'package tender was accepted';
  exception
    when others then
      if position('此付款方式目前尚未開放' in sqlerrm) = 0 then
        raise;
      end if;
  end;
end;
$$;
