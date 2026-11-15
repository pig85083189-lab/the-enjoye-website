-- REVIEW ONLY. Do not apply to production until staff authentication and payment
-- confirmation are enforced in the server endpoint and isolated tests pass.
-- This function accepts canonical UUIDs only; never expose service_role to a browser.
begin;

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
  -- Format check only: authenticated membership/checkout authority must be checked by API.
  if p_method is null or p_method not in ('CASH','CREDIT_CARD','BANK_TRANSFER','OTHER') then
    raise exception 'Invalid manual payment method';
  end if;
  if not public.is_operational_staff_id(p_staff_id) then
    raise exception 'Invalid operational staff';
  end if;

  -- Serialize all top-ups per customer, including retries before account creation.
  perform 1 from public.customers
    where id = p_customer_id and organization_id = p_organization_id
      and status = 'ACTIVE'
    for update;
  if not found then raise exception 'Customer not found in organization'; end if;
  -- Fail closed unless this canonical customer has a verified, confirmed LINE binding.
  perform 1 from public.line_customer_bindings b
    join public.organizations o on o.app_id = b.organization_id
   where o.id = p_organization_id
     and b.customer_uuid = p_customer_id
     and b.status = 'active'
     and b.verified is true
     and b.confirmed_at is not null
     and b.bound_at is not null
     and b.unbound_at is null
     and b.blocked_at is null
     and nullif(trim(b.line_user_id_hash), '') is not null
    for share of b;
  if not found then raise exception 'LINE member binding required for top-up'; end if;
  perform 1 from public.locations
    where id = p_location_id and organization_id = p_organization_id
      and is_active = true;
  if not found then raise exception 'Invalid location'; end if;

  -- A reused effect key with different parameters must never silently succeed.
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
  -- A suspended or closed wallet must not be silently replaced with a new active wallet.
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

-- Explicitly deny all non-server roles. API must authenticate the actual
-- staff membership and confirmed external payment BEFORE calling this RPC.
revoke all on function public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)
  from public, anon, authenticated;
grant execute on function public.post_stored_value_top_up_v1(uuid,uuid,uuid,text,bigint,text,text)
  to service_role;
commit;
