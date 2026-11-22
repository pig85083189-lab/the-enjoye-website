-- REVIEW ONLY. Do not apply until checkout writes PACKAGE_PURCHASE transaction items.
-- Atomic package issuance from a completed, matching, single-quantity paid item.
-- Requires service_role-only execution and a verified staff caller at the API layer.
create or replace function public.issue_customer_package_v1(
  p_organization_id uuid,
  p_transaction_item_id uuid,
  p_staff_id text
) returns uuid
language plpgsql security invoker
set search_path = public, pg_temp
as $$
declare
  v_item public.transaction_items%rowtype;
  v_tx public.transactions%rowtype;
  v_definition public.package_definitions%rowtype;
  v_service_ids text[];
  v_existing uuid;
  v_package_id uuid;
  v_now timestamptz := now();
  v_key text := 'package:purchase:item:' || p_transaction_item_id::text;
begin
  if p_organization_id is null or p_transaction_item_id is null
     or p_staff_id is null or not public.is_operational_staff_id(p_staff_id) then
    raise exception 'INVALID_PACKAGE_ISSUANCE';
  end if;
  select * into v_item from public.transaction_items
  where id=p_transaction_item_id and organization_id=p_organization_id
    and type='PACKAGE_PURCHASE' for update;
  if not found then raise exception 'PACKAGE_PURCHASE_ITEM_NOT_FOUND'; end if;
  select * into v_tx from public.transactions
  where id=v_item.transaction_id and organization_id=p_organization_id
    and status='COMPLETED' for update;
  if not found then raise exception 'COMPLETED_TRANSACTION_REQUIRED'; end if;
  select id into v_existing from public.package_ledger_entries
  where organization_id=p_organization_id and effect_key=v_key;
  if found then
    select customer_package_id into v_package_id from public.package_ledger_entries
    where id=v_existing and transaction_id=v_tx.id and customer_id=v_tx.customer_id
      and type='PURCHASE' and session_delta > 0;
    if v_package_id is null then raise exception 'PACKAGE_ISSUANCE_KEY_CONFLICT'; end if;
    return v_package_id;
  end if;
  if v_item.quantity <> 1 then raise exception 'PACKAGE_QUANTITY_MUST_BE_ONE'; end if;
  select * into v_definition from public.package_definitions
  where id::text=v_item.reference_id and organization_id=p_organization_id
    and is_active for share;
  if not found then raise exception 'PACKAGE_DEFINITION_NOT_FOUND'; end if;
  if v_item.session_count_snapshot <> v_definition.session_count
     or v_item.unit_price_minor <> v_definition.price_minor
     or v_item.line_total_minor <> v_definition.price_minor\n     or v_tx.total_minor < v_item.line_total_minor then
    raise exception 'PACKAGE_PRICE_OR_SESSIONS_MISMATCH';
  end if;
  select array_agg(x->>'serviceId' order by ordinality) into v_service_ids
  from jsonb_array_elements(v_definition.included_services) with ordinality as j(x,ordinality);
  if coalesce(array_length(v_service_ids,1),0)=0\n     or exists (select 1 from unnest(v_service_ids) s where s is null or s !~* '^[0-9a-f-]{36}
    select 1 from unnest(v_service_ids) s
    where not exists (select 1 from public.services
      where id::text=s and organization_id=p_organization_id and is_active)
  ) then raise exception 'PACKAGE_ENTITLEMENTS_INVALID'; end if;
  insert into public.customer_packages (
    organization_id,customer_id,package_definition_id,purchase_transaction_id,
    name_snapshot,session_count_snapshot,price_snapshot_minor,
    included_service_ids_snapshot,purchased_at,activated_at,expires_at,status
  ) values (
    p_organization_id,v_tx.customer_id,v_definition.id,v_tx.id,
    v_definition.name,v_definition.session_count,v_item.line_total_minor,
    v_service_ids,v_now,v_now,
    case when v_definition.validity_days is null then null
         else v_now + make_interval(days => v_definition.validity_days) end,'ACTIVE'
  ) returning id into v_package_id;
  insert into public.package_ledger_entries (
    organization_id,customer_package_id,customer_id,type,session_delta,
    transaction_id,effect_key,created_by_staff_id
  ) values (
    p_organization_id,v_package_id,v_tx.customer_id,'PURCHASE',
    v_definition.session_count,v_tx.id,v_key,p_staff_id
  );
  return v_package_id;
end;
$$;
revoke all on function public.issue_customer_package_v1(uuid,uuid,text) from public,anon,authenticated;
-- Service-role execution is only enabled when this reviewed migration is explicitly applied.
grant execute on function public.issue_customer_package_v1(uuid,uuid,text) to service_role;
)\n     or exists (
    select 1 from unnest(v_service_ids) s
    where not exists (select 1 from public.services
      where id::text=s and organization_id=p_organization_id and is_active)
  ) then raise exception 'PACKAGE_ENTITLEMENTS_INVALID'; end if;
  insert into public.customer_packages (
    organization_id,customer_id,package_definition_id,purchase_transaction_id,
    name_snapshot,session_count_snapshot,price_snapshot_minor,
    included_service_ids_snapshot,purchased_at,activated_at,expires_at,status
  ) values (
    p_organization_id,v_tx.customer_id,v_definition.id,v_tx.id,
    v_definition.name,v_definition.session_count,v_item.line_total_minor,
    v_service_ids,v_now,v_now,
    case when v_definition.validity_days is null then null
         else v_now + make_interval(days => v_definition.validity_days) end,'ACTIVE'
  ) returning id into v_package_id;
  insert into public.package_ledger_entries (
    organization_id,customer_package_id,customer_id,type,session_delta,
    transaction_id,effect_key,created_by_staff_id
  ) values (
    p_organization_id,v_package_id,v_tx.customer_id,'PURCHASE',
    v_definition.session_count,v_tx.id,v_key,p_staff_id
  );
  return v_package_id;
end;
$$;
revoke all on function public.issue_customer_package_v1(uuid,uuid,text) from public,anon,authenticated;
-- Service-role execution is only enabled when this reviewed migration is explicitly applied.
grant execute on function public.issue_customer_package_v1(uuid,uuid,text) to service_role;
