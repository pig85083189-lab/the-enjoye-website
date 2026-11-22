-- Read-only catalog for package identity mapping. No package writes or
-- activation of checkout are performed by this RPC.
create or replace function public.commerce_package_catalog()
returns jsonb language plpgsql stable security definer
set search_path=public,pg_temp as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then raise exception '沒有權限查詢套票'; end if;
  -- Derive accessible organizations using existing membership policy.
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'organizationDbId',d.organization_id::text,
      'packageDefinitionDbId',d.id::text,
      'packageDefinitionAppId',d.app_id,
      'name',d.name,
      'sessionCount',d.session_count,
      'priceMinor',d.price_minor,
      'includedServices',d.included_services
    ) order by d.name,d.id)
    from public.package_definitions d
    where d.is_active=true and public.user_has_org_membership(d.organization_id)
  ),'[]'::jsonb);
end; $$;

revoke all on function public.commerce_package_catalog() from public,anon;
grant execute on function public.commerce_package_catalog() to authenticated;
