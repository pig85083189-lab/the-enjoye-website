-- Preserve package redemption intent in the immutable transaction snapshot.
-- The existing generic settle_checkout_draft intentionally remains unchanged.
-- Only the dedicated atomic redemption RPC may create a package-redemption
-- transaction. PostgreSQL transaction-local setting cannot leak to other calls.
create or replace function public.capture_atomic_package_redemption_snapshot()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_draft public.checkout_drafts;
  v_package public.customer_packages;
  v_service public.services;
  v_expected text;
begin
  if new.checkout_draft_id is null then return new; end if;
  select * into v_draft from public.checkout_drafts
    where id=new.checkout_draft_id and organization_id=new.organization_id;
  if v_draft.id is null or v_draft.package_redemption is null or
     v_draft.package_redemption='null'::jsonb then
    return new;
  end if;

  v_expected := current_setting('beauty_os.atomic_package_redemption',true);
  if v_expected is distinct from v_draft.id::text then
    raise exception '套票扣堂必須使用原子結帳入口';
  end if;
  if new.package_redemption is not null then
    raise exception '套票扣堂交易快照不可由外部提供';
  end if;
  if new.customer_id is distinct from v_draft.customer_id then
    raise exception '套票扣堂顧客不符';
  end if;

  select * into v_package from public.customer_packages
    where id::text=current_setting('beauty_os.atomic_customer_package',true)
      and organization_id=new.organization_id
      and customer_id=new.customer_id;
  select * into v_service from public.services
    where id::text=current_setting('beauty_os.atomic_service',true)
      and organization_id=new.organization_id;
  if v_package.id is null or v_service.id is null or
     v_draft.package_redemption->>'customerPackageId' is distinct from v_package.app_id or
     v_draft.package_redemption->>'serviceId' is distinct from v_service.app_id or
     (v_draft.package_redemption->>'sessions')::integer is distinct from 1 or
     not (v_service.app_id=any(v_package.included_service_ids_snapshot)) then
    raise exception '套票扣堂交易快照不符';
  end if;

  new.package_redemption := v_draft.package_redemption;
  return new;
end; $$;

drop trigger if exists trg_atomic_package_redemption_snapshot on public.transactions;
create trigger trg_atomic_package_redemption_snapshot
before insert on public.transactions for each row
execute function public.capture_atomic_package_redemption_snapshot();

revoke all on function public.capture_atomic_package_redemption_snapshot() from public,anon,authenticated;
comment on function public.capture_atomic_package_redemption_snapshot()
is 'Fail closed for package redemption and preserve immutable transaction snapshot only in atomic redemption RPC.';
