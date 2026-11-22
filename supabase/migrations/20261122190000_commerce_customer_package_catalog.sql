-- Read-only authenticated package wallet catalog. No ledger writes.
-- Uses explicit organization membership, never a client-supplied customer ID.
create or replace function public.commerce_customer_package_catalog(
  p_customer_id uuid
) returns jsonb language plpgsql stable security definer
set search_path = public, pg_temp as $$
declare
  v_customer public.customers;
begin
  if auth.uid() is null then raise exception '沒有權限查詢顧客套票'; end if;
  select * into v_customer from public.customers where id=p_customer_id;
  if v_customer.id is null or not public.user_has_org_membership(v_customer.organization_id)
  then raise exception '沒有權限查詢顧客套票'; end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'customerPackageDbId', p.id::text,
      'customerPackageAppId', p.app_id,
      'customerDbId', p.customer_id::text,
      'packageDefinitionDbId', p.package_definition_id::text,
      'name', p.name_snapshot,
      'status', p.status::text,
      'expiresAt', p.expires_at,
      'remainingSessions', coalesce(l.balance,0),
      'includedServiceAppIds', to_jsonb(p.included_service_ids_snapshot)
    ) order by p.purchased_at desc,p.id)
    from public.customer_packages p
    left join lateral (
      select sum(e.session_delta)::bigint as balance
      from public.package_ledger_entries e
      where e.organization_id=p.organization_id
        and e.customer_package_id=p.id
    ) l on true
    where p.organization_id=v_customer.organization_id
      and p.customer_id=v_customer.id
  ),'[]'::jsonb);
end; $$;

revoke all on function public.commerce_customer_package_catalog(uuid) from public,anon;
grant execute on function public.commerce_customer_package_catalog(uuid) to authenticated;
comment on function public.commerce_customer_package_catalog(uuid)
is 'Read-only customer package balances and UUID mappings for authorized staff.';
