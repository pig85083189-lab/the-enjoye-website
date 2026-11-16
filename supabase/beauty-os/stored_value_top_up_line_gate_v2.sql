-- Finance-database manual top-up.
-- The same function body is installed by
-- supabase/migrations/20261116143000_stored_value_line_checkout_gate.sql.
-- Apply that migration on bfzquejrtgqzzarhkiya after
-- 20261116120000_line_verified_booking_source_link.sql. Running this file
-- afterwards replaces the function with the same body; it does not rewrite
-- customers, LINE bindings, or ledger rows.
--
-- app/api/staff/stored-value/top-up/route.ts authenticates the staff membership
-- and requires manualPaymentConfirmed before this RPC. The function still
-- rejects a customer who is not a current LINE member, and the ledger insert
-- trigger repeats that check. A repeated effect key returns the original entry.
-- service_role is the only execute grantee. The browser never receives it.

create or replace function public.post_stored_value_top_up_v1(
  p_organization_id uuid,
  p_customer_id uuid,
  p_location_id uuid,
  p_staff_id text,
  p_amount_minor bigint,
  p_effect_key text,
  p_method text
) returns table(entry_id uuid, account_id uuid, balance_minor bigint, was_duplicate boolean)
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_account uuid;
  v_entry record;
  v_entry_id uuid;
  v_balance bigint;
begin
  if p_organization_id is null or p_customer_id is null or
     p_location_id is null or p_staff_id is null or
     p_amount_minor is null or p_amount_minor <= 0 or
     p_amount_minor > 100000000 or
     p_effect_key is null or length(trim(p_effect_key)) < 16 or
     length(p_effect_key) > 180 then
    raise exception 'Invalid top-up request';
  end if;
  if p_method is null or p_method not in ('CASH','CREDIT_CARD','BANK_TRANSFER','OTHER') then
    raise exception 'Invalid manual payment method';
  end if;
  if not public.is_operational_staff_id(p_staff_id) then
    raise exception 'Invalid operational staff';
  end if;

  perform 1 from public.customers
    where id = p_customer_id and organization_id = p_organization_id
      and status = 'ACTIVE'
    for update;
  if not found then raise exception 'Customer not found in organization'; end if;
  if not public.customer_line_membership_is_current(p_organization_id, p_customer_id) then
    raise exception '必須先完成 LINE 會員綁定';
  end if;
  perform 1 from public.locations
    where id = p_location_id and organization_id = p_organization_id
      and is_active = true;
  if not found then raise exception 'Invalid location'; end if;

  select e.id,e.account_id,e.customer_id,e.location_id,e.created_by_staff_id,
         e.amount_delta_minor,e.type,e.reason
    into v_entry
    from public.stored_value_ledger_entries e
   where e.organization_id = p_organization_id and e.effect_key = p_effect_key;
  if found then
    if v_entry.customer_id <> p_customer_id or
       v_entry.location_id is distinct from p_location_id or
       v_entry.created_by_staff_id <> p_staff_id or
       v_entry.amount_delta_minor <> p_amount_minor or
       v_entry.type <> 'TOP_UP'::public.stored_value_ledger_type or
       v_entry.reason is distinct from ('MANUAL_RECEIPT:' || p_method) then
      raise exception 'Idempotency key conflict';
    end if;
    select coalesce(sum(e.amount_delta_minor),0) into v_balance
      from public.stored_value_ledger_entries e
     where e.account_id = v_entry.account_id;
    return query select v_entry.id, v_entry.account_id, v_balance, true;
    return;
  end if;

  select a.id into v_account from public.stored_value_accounts a
    where a.organization_id = p_organization_id and a.customer_id = p_customer_id
      and a.status = 'ACTIVE' and a.currency = 'TWD'
    for update;
  if exists (
    select 1 from public.stored_value_accounts a
    where a.organization_id = p_organization_id
      and a.customer_id = p_customer_id
      and (a.status <> 'ACTIVE' or a.currency <> 'TWD')
  ) then
    raise exception 'Wallet is not eligible for top-up';
  end if;
  if v_account is null then
    insert into public.stored_value_accounts (organization_id,customer_id,currency,status)
      values (p_organization_id,p_customer_id,'TWD','ACTIVE')
      returning id into v_account;
  end if;

  insert into public.stored_value_ledger_entries (
    organization_id,account_id,customer_id,type,amount_delta_minor,
    location_id,created_by_staff_id,effect_key,reason
  ) values (
    p_organization_id,v_account,p_customer_id,'TOP_UP',p_amount_minor,
    p_location_id,p_staff_id,p_effect_key,'MANUAL_RECEIPT:' || p_method
  ) returning id into v_entry_id;

  select coalesce(sum(e.amount_delta_minor),0) into v_balance
    from public.stored_value_ledger_entries e where e.account_id = v_account;
  return query select v_entry_id,v_account,v_balance,false;
end;
$$;

revoke all on function public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text) to service_role';
  end if;
end $$;
