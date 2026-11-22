-- Package atomic ledger foundation. Additive, not activated by checkout yet.
-- Both operations run in one PostgreSQL transaction per RPC invocation.
create or replace function public.atomic_purchase_customer_package(
  p_transaction_id uuid, p_definition_id uuid, p_effect_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tx public.transactions;
  v_def public.package_definitions;
  v_pkg uuid;
  v_existing public.package_ledger_entries;
  v_actor text;
begin
  if p_effect_key is null or length(trim(p_effect_key)) < 8 then
    raise exception '套票入帳識別碼無效';
  end if;
  select * into v_tx from public.transactions where id=p_transaction_id for update;
  if v_tx.id is null or v_tx.status <> 'COMPLETED' then
    raise exception '必須先完成結帳才能入帳套票';
  end if;
  v_actor := public.assert_commerce_checkout_actor(v_tx.organization_id,v_tx.location_id);
  select * into v_existing from public.package_ledger_entries
    where organization_id=v_tx.organization_id and effect_key=p_effect_key;
  if found then
    if v_existing.type <> 'PURCHASE' or v_existing.transaction_id is distinct from v_tx.id
      or not exists(select 1 from public.customer_packages c where c.id=v_existing.customer_package_id and c.package_definition_id=p_definition_id and c.customer_id=v_tx.customer_id)
    then raise exception '套票入帳識別碼衝突'; end if;
    return v_existing.customer_package_id;
  end if;
  select * into v_def from public.package_definitions
    where id=p_definition_id and organization_id=v_tx.organization_id and is_active=true for share;
  if v_def.id is null or v_def.session_count < 1 then raise exception '套票方案無效'; end if;
  if not exists (
    select 1 from public.transaction_items i where i.transaction_id=v_tx.id
      and i.organization_id=v_tx.organization_id and i.type='PACKAGE_PURCHASE'
      and i.reference_id=v_def.app_id and i.quantity=1
      and i.session_count_snapshot=v_def.session_count
      and i.unit_price_minor=v_def.price_minor
      and i.line_subtotal_minor=v_def.price_minor
  ) then raise exception '交易中找不到對應套票購買項目'; end if;
  if exists (
    select 1 from public.customer_packages c
    where c.organization_id=v_tx.organization_id and c.purchase_transaction_id=v_tx.id
      and c.package_definition_id=v_def.id
  ) then raise exception '交易套票已入帳，請核對原始紀錄'; end if;
  insert into public.customer_packages (
    organization_id,customer_id,package_definition_id,purchase_transaction_id,
    app_id,name_snapshot,session_count_snapshot,price_snapshot_minor,
    included_service_ids_snapshot,purchased_at,activated_at,expires_at,status
  ) values (
    v_tx.organization_id,v_tx.customer_id,v_def.id,v_tx.id,
    'cpkg-'||replace(gen_random_uuid()::text,'-',''),v_def.name,v_def.session_count,v_def.price_minor,
    coalesce((select array_agg(x->>'serviceId') from jsonb_array_elements(v_def.included_services) x),array[]::text[]),
    now(),now(),case when v_def.validity_days is null then null else now()+make_interval(days=>v_def.validity_days) end,'ACTIVE'
  ) returning id into v_pkg;
  insert into public.package_ledger_entries (
    organization_id,customer_package_id,customer_id,app_id,type,session_delta,
    transaction_id,location_id,effect_key,created_by_staff_id
  ) values (
    v_tx.organization_id,v_pkg,v_tx.customer_id,
    'pled-'||replace(gen_random_uuid()::text,'-',''),'PURCHASE',v_def.session_count,
    v_tx.id,v_tx.location_id,p_effect_key,v_actor
  );
  return v_pkg;
end; $$;

create or replace function public.atomic_redeem_customer_package(
  p_customer_package_id uuid,p_transaction_id uuid,p_service_id uuid,p_effect_key text
) returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_tx public.transactions;
  v_pkg public.customer_packages;
  v_service public.services;
  v_existing public.package_ledger_entries;
  v_balance bigint;
  v_entry uuid;
  v_actor text;
begin
  if p_effect_key is null or length(trim(p_effect_key)) < 8 then
    raise exception '套票扣堂識別碼無效';
  end if;
  select * into v_tx from public.transactions where id=p_transaction_id for update;
  if v_tx.id is null or v_tx.status <> 'COMPLETED' then raise exception '必須先完成結帳才能扣堂'; end if;
  v_actor := public.assert_commerce_checkout_actor(v_tx.organization_id,v_tx.location_id);
  select * into v_pkg from public.customer_packages
    where id=p_customer_package_id and organization_id=v_tx.organization_id for update;
  if v_pkg.id is null or v_pkg.customer_id <> v_tx.customer_id then raise exception '套票與顧客不符'; end if;
  select * into v_existing from public.package_ledger_entries
    where organization_id=v_tx.organization_id and effect_key=p_effect_key;
  if found then
    if v_existing.type <> 'REDEMPTION' or v_existing.customer_package_id<>v_pkg.id
      or v_existing.transaction_id is distinct from v_tx.id or v_existing.service_id is distinct from p_service_id
    then raise exception '套票扣堂識別碼衝突'; end if;
    return v_existing.id;
  end if;
  if v_pkg.status <> 'ACTIVE' or (v_pkg.expires_at is not null and v_pkg.expires_at <= now())
  then raise exception '套票已失效'; end if;
  select * into v_service from public.services where id=p_service_id and organization_id=v_tx.organization_id;
  if v_service.id is null or not (v_service.app_id = any(v_pkg.included_service_ids_snapshot))
  then raise exception '此療程不適用該套票'; end if;
  if not exists (
    select 1 from public.transaction_items i where i.transaction_id=v_tx.id
      and i.organization_id=v_tx.organization_id and i.type='SERVICE'
      and i.reference_id=v_service.app_id
  ) then raise exception '交易未包含指定療程'; end if;
  if v_tx.treatment_id is not null and not exists (
    select 1 from public.treatments t where t.id=v_tx.treatment_id
      and t.organization_id=v_tx.organization_id and t.service_id=p_service_id
  ) then raise exception '交易療程與扣堂療程不符'; end if;
  if exists (
    select 1 from public.package_ledger_entries e
    where e.organization_id=v_tx.organization_id and e.customer_package_id=v_pkg.id
      and e.transaction_id=v_tx.id and e.type='REDEMPTION'
  ) then raise exception '此交易已扣堂'; end if;
  select coalesce(sum(session_delta),0) into v_balance from public.package_ledger_entries
    where organization_id=v_tx.organization_id and customer_package_id=v_pkg.id;
  if v_balance < 1 then raise exception '套票剩餘堂數不足'; end if;
  insert into public.package_ledger_entries (
    organization_id,customer_package_id,customer_id,app_id,type,session_delta,
    service_id,appointment_id,treatment_id,transaction_id,location_id,effect_key,created_by_staff_id
  ) values (
    v_tx.organization_id,v_pkg.id,v_pkg.customer_id,
    'pled-'||replace(gen_random_uuid()::text,'-',''),'REDEMPTION',-1,
    p_service_id,v_tx.appointment_id,v_tx.treatment_id,v_tx.id,v_tx.location_id,p_effect_key,v_actor
  ) returning id into v_entry;
  return v_entry;
end; $$;

revoke all on function public.atomic_purchase_customer_package(uuid,uuid,text) from public,anon;
revoke all on function public.atomic_redeem_customer_package(uuid,uuid,uuid,text) from public,anon;
grant execute on function public.atomic_purchase_customer_package(uuid,uuid,text) to authenticated;
grant execute on function public.atomic_redeem_customer_package(uuid,uuid,uuid,text) to authenticated;
