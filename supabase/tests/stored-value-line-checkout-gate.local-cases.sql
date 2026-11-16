-- Local finance cases for the LINE checkout gate. No production customers.
do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_loc uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  v_owner uuid := '99999999-9999-4999-8999-999999999999';
  v_hist uuid := 'c1000000-0000-4000-8000-0000000000c1';
  v_current uuid := 'c2000000-0000-4000-8000-0000000000c2';
  v_none uuid := 'c3000000-0000-4000-8000-0000000000c3';
  v_revoked uuid := 'c4000000-0000-4000-8000-0000000000c4';
  v_pending uuid := 'c5000000-0000-4000-8000-0000000000c5';
  v_appointment uuid := 'a1000000-0000-4000-8000-0000000000a1';
  v_dup boolean;
  v_balance bigint;
begin
  if (select amount_delta_minor from public.stored_value_ledger_entries where effect_key = 'seed:hist') <> 700
     or (select status from public.appointments where id = v_appointment) <> 'COMPLETED'
     or (select count(*) from public.customers where id = v_hist) <> 1 then
    raise exception 'historical customer, appointment, or stored-value row changed before the cases';
  end if;

  perform set_config('tests.uid', v_owner::text, true);
  select was_duplicate into v_dup
  from public.post_stored_value_top_up_v1(
    v_org, v_current, v_loc, 'staff-owner-test', 2000, 'topup:current-000001', 'CASH'
  );
  if v_dup then
    raise exception 'first current top-up was treated as a duplicate';
  end if;
  select was_duplicate into v_dup
  from public.post_stored_value_top_up_v1(
    v_org, v_current, v_loc, 'staff-owner-test', 2000, 'topup:current-000001', 'CASH'
  );
  if not v_dup
     or (select count(*) from public.stored_value_ledger_entries where effect_key = 'topup:current-000001') <> 1 then
    raise exception 'repeated top-up wrote another ledger row';
  end if;

  perform public.confirm_customer_wallet_identity(
    'org-stored-value-test', 'cust-current-booking', 'cust-current-wallet', '隔離測試現行 LINE 儲值'
  );
  perform public.confirm_customer_wallet_identity(
    'org-stored-value-test', 'cust-revoked-booking', 'cust-revoked-wallet', '隔離測試解除前的儲值對應'
  );
  perform public.confirm_booking_source_customer_link(
    'org-stored-value-test', 'src-current-0001', 'cust-current-booking',
    'CUSTOMER_PRESENT', '隔離測試現行 LINE 對應', v_owner, 'staff-owner-test'
  );
  perform public.confirm_booking_source_customer_link(
    'org-stored-value-test', 'src-revoked-0001', 'cust-revoked-booking',
    'CUSTOMER_PRESENT', '隔離測試解除前的預約對應', v_owner, 'staff-owner-test'
  );
  update public.line_customer_bindings
     set unbound_at = now() - interval '1 hour'
   where customer_uuid = v_revoked;
  insert into public.member_line_customer_links (organization_id, customer_id, verified_at, line_subject_hash)
  values (v_org, v_revoked, now(), repeat('cd', 32));

  begin
    perform public.post_stored_value_top_up_v1(
      v_org, v_none, v_loc, 'staff-owner-test', 100, 'topup:none-000000001', 'CASH'
    );
    raise exception 'unbound customer topped up';
  exception
    when others then
      if position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.post_stored_value_top_up_v1(
      v_org, v_revoked, v_loc, 'staff-owner-test', 100, 'topup:revoked-000001', 'CASH'
    );
    raise exception 'revoked customer topped up';
  exception
    when others then
      if position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.post_stored_value_top_up_v1(
      v_org, v_pending, v_loc, 'staff-owner-test', 100, 'topup:pending-000001', 'CASH'
    );
    raise exception 'pending customer topped up';
  exception
    when others then
      if position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.post_stored_value_top_up_v1(
      v_org, v_hist, v_loc, 'staff-owner-test', 100, 'topup:hist-000000001', 'CASH'
    );
    raise exception 'historical unbound customer topped up';
  exception
    when others then
      if position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then raise; end if;
  end;

  begin
    perform public.settle_booking_source_checkout(
      'org-stored-value-test', 'src-none-000001', 'sale-none-0001', 'loc-isolated', 100, 'staff-owner-test'
    );
    raise exception 'unbound customer debited stored value';
  exception
    when others then
      if position('必須先完成顧客身分對應' in sqlerrm) = 0
         and position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then
        raise;
      end if;
  end;
  begin
    perform public.settle_booking_source_checkout(
      'org-stored-value-test', 'src-revoked-0001', 'sale-revoked-001', 'loc-isolated', 100, 'staff-owner-test'
    );
    raise exception 'revoked customer debited stored value';
  exception
    when others then
      if position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then raise; end if;
  end;
  begin
    perform public.settle_booking_source_checkout(
      'org-stored-value-test', 'src-pending-0001', 'sale-pending-001', 'loc-isolated', 100, 'staff-owner-test'
    );
    raise exception 'pending customer debited stored value';
  exception
    when others then
      if position('必須先完成顧客身分對應' in sqlerrm) = 0
         and position('必須先完成 LINE 會員綁定' in sqlerrm) = 0 then
        raise;
      end if;
  end;

  select coalesce(sum(amount_delta_minor), 0) into v_balance
  from public.stored_value_ledger_entries where customer_id = v_current;
  if v_balance <> 2000
     or (select coalesce(sum(amount_delta_minor), 0) from public.stored_value_ledger_entries where customer_id = v_none) <> 1000
     or (select coalesce(sum(amount_delta_minor), 0) from public.stored_value_ledger_entries where customer_id = v_revoked) <> 1000
     or (select coalesce(sum(amount_delta_minor), 0) from public.stored_value_ledger_entries where customer_id = v_pending) <> 1000
     or (select amount_delta_minor from public.stored_value_ledger_entries where effect_key = 'seed:hist') <> 700
     or (select status from public.appointments where id = v_appointment) <> 'COMPLETED'
     or (select count(*) from public.stored_value_ledger_entries where effect_key like 'topup:none%' or effect_key like 'topup:revoked%' or effect_key like 'topup:pending%' or effect_key like 'topup:hist%') <> 0
     or (select count(*) from public.stored_value_ledger_entries where type = 'PAYMENT') <> 0 then
    raise exception 'LINE gate changed a balance it should have left untouched';
  end if;
end $$;
