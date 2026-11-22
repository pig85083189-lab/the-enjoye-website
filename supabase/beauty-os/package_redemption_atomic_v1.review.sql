-- Package redemption transaction. REVIEW ONLY: not applied to production.
-- Caller must be a trusted, authenticated server process. Never grant to anon/authenticated.
create or replace function public.redeem_customer_package_v1(
  p_organization_id uuid,
  p_customer_package_id uuid,
  p_service_id uuid,
  p_transaction_id uuid,
  p_staff_id text
) returns uuid
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_package public.customer_packages%rowtype;
  v_transaction public.transactions%rowtype;
  v_balance bigint;
  v_existing uuid;
  v_entry_id uuid;
  v_key text := 'package:redeem:transaction:' || p_transaction_id::text;
begin
  if p_organization_id is null or p_customer_package_id is null or p_service_id is null
     or p_transaction_id is null or p_staff_id is null or not public.is_operational_staff_id(p_staff_id) then
    raise exception 'INVALID_PACKAGE_REDEMPTION';
  end if;
  -- Lock the package first to serialize competing redemptions.
  select * into v_package from public.customer_packages
  where id = p_customer_package_id and organization_id = p_organization_id for update;
  if not found then raise exception 'PACKAGE_NOT_FOUND'; end if;
  select * into v_transaction from public.transactions
  where id = p_transaction_id and organization_id = p_organization_id
    and customer_id = v_package.customer_id and status = 'COMPLETED';
  if not found then raise exception 'COMPLETED_TRANSACTION_REQUIRED'; end if;
  select id into v_existing from public.package_ledger_entries
  where organization_id = p_organization_id and effect_key = v_key;
  if found then
    if not exists (select 1 from public.package_ledger_entries
      where id=v_existing and customer_package_id=p_customer_package_id and service_id=p_service_id
        and transaction_id=p_transaction_id and type='REDEMPTION') then
      raise exception 'REDEMPTION_KEY_CONFLICT';
    end if;
    return v_existing;
  end if;
  if v_package.status <> 'ACTIVE' or
     (v_package.expires_at is not null and v_package.expires_at <= now()) then
    raise exception 'PACKAGE_INACTIVE';
  end if;
  if not (p_service_id = any(v_package.included_service_ids_snapshot)) then
    raise exception 'SERVICE_NOT_INCLUDED';
  end if;
  if not exists (select 1 from public.services
    where id=p_service_id and organization_id=p_organization_id and is_active) then
    raise exception 'SERVICE_NOT_ACTIVE';
  end if;
  select coalesce(sum(session_delta),0) into v_balance from public.package_ledger_entries
  where organization_id=p_organization_id and customer_package_id=p_customer_package_id;
  if v_balance < 1 then raise exception 'INSUFFICIENT_PACKAGE_SESSIONS'; end if;
  insert into public.package_ledger_entries (
    organization_id,customer_package_id,customer_id,type,session_delta,
    service_id,transaction_id,effect_key,created_by_staff_id
  ) values (
    p_organization_id,p_customer_package_id,v_package.customer_id,'REDEMPTION',-1,
    p_service_id,p_transaction_id,v_key,p_staff_id
  ) returning id into v_entry_id;
  if v_balance = 1 then
    update public.customer_packages set status='EXHAUSTED',updated_at=now()
    where id=p_customer_package_id and organization_id=p_organization_id;
  end if;
  return v_entry_id;
end;
$$;
revoke all on function public.redeem_customer_package_v1(uuid,uuid,uuid,uuid,text) from public, anon, authenticated;
-- Grant execute only to service_role after review and integration testing.
