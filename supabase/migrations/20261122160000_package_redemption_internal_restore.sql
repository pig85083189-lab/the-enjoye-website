-- Internal-only append-only restoration primitive.
-- IMPORTANT: this does not authorize voiding a checkout. The future void
-- workflow must validate cancellation and invoke this in the same transaction.
create or replace function public.restore_package_redemption_internal(
  p_redemption_entry_id uuid,
  p_reason text,
  p_effect_key text
) returns uuid language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_redemption public.package_ledger_entries;
  v_package public.customer_packages;
  v_existing public.package_ledger_entries;
  v_actor text;
  v_new_id uuid;
begin
  if p_effect_key is null or length(trim(p_effect_key))<8 then
    raise exception '回補識別碼無效';
  end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception '回補必須填寫原因';
  end if;
  select * into v_redemption from public.package_ledger_entries
    where id=p_redemption_entry_id and type='REDEMPTION';
  if v_redemption.id is null or v_redemption.session_delta<>-1
  then raise exception '找不到有效扣堂紀錄'; end if;
  v_actor := public.assert_commerce_checkout_actor(
    v_redemption.organization_id,v_redemption.location_id
  );
  select * into v_package from public.customer_packages
    where id=v_redemption.customer_package_id and organization_id=v_redemption.organization_id
    for update;
  if v_package.id is null or v_package.customer_id<>v_redemption.customer_id
  then raise exception '套票與扣堂紀錄不符'; end if;
  select * into v_existing from public.package_ledger_entries
    where organization_id=v_redemption.organization_id and effect_key=p_effect_key;
  if found then
    if v_existing.type<>'REVERSAL' or v_existing.reverses_entry_id is distinct from v_redemption.id
    then raise exception '回補識別碼衝突'; end if;
    return v_existing.id;
  end if;
  if exists(select 1 from public.package_ledger_entries e
    where e.organization_id=v_redemption.organization_id
      and e.reverses_entry_id=v_redemption.id and e.type='REVERSAL')
  then raise exception '此扣堂已回補'; end if;
  insert into public.package_ledger_entries(
    organization_id,customer_package_id,customer_id,app_id,type,session_delta,
    service_id,appointment_id,treatment_id,transaction_id,location_id,
    reason,effect_key,reverses_entry_id,created_by_staff_id
  ) values(
    v_redemption.organization_id,v_redemption.customer_package_id,v_redemption.customer_id,
    'pled-'||replace(gen_random_uuid()::text,'-',''),'REVERSAL',1,
    v_redemption.service_id,v_redemption.appointment_id,v_redemption.treatment_id,
    v_redemption.transaction_id,v_redemption.location_id,
    p_reason,p_effect_key,v_redemption.id,v_actor
  ) returning id into v_new_id;
  -- Re-open exhausted packages after a valid reversal, unless expired or voided.
  if v_package.status='EXHAUSTED' and
     (v_package.expires_at is null or v_package.expires_at>now()) then
    update public.customer_packages set status='ACTIVE' where id=v_package.id;
  end if;
  return v_new_id;
end; $$;

-- Prevent restoring one redemption twice, including different effect keys.
create unique index if not exists ux_package_redemption_single_reversal
on public.package_ledger_entries(organization_id,reverses_entry_id)
where type='REVERSAL' and reverses_entry_id is not null;

revoke all on function public.restore_package_redemption_internal(uuid,text,text)
  from public,anon,authenticated;
comment on function public.restore_package_redemption_internal(uuid,text,text)
is 'Internal-only reversal helper; do not grant to authenticated until a verified void workflow exists.';
