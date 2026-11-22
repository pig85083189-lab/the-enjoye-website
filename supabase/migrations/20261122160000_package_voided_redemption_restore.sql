-- Restore one redeemed session only after its checkout transaction is VOIDED.
-- Append-only reversal; never edit or delete the original redemption.
create unique index if not exists ux_package_ledger_single_reversal
on public.package_ledger_entries (organization_id,reverses_entry_id)
where reverses_entry_id is not null;

create or replace function public.restore_voided_package_redemption(
  p_redemption_entry_id uuid,
  p_reason text
) returns uuid language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_red public.package_ledger_entries;
  v_pkg public.customer_packages;
  v_tx public.transactions;
  v_prior uuid;
  v_new uuid;
  v_actor text;
begin
  if auth.uid() is null then raise exception '沒有權限回補'; end if;
  if length(trim(coalesce(p_reason,'')))<3 then raise exception '請填寫回補原因'; end if;
  select * into v_red from public.package_ledger_entries
    where id=p_redemption_entry_id and type='REDEMPTION';
  if v_red.id is null or v_red.transaction_id is null or v_red.session_delta<>-1
  then raise exception '找不到可回補的套票扣堂紀錄'; end if;
  select * into v_pkg from public.customer_packages
    where id=v_red.customer_package_id and organization_id=v_red.organization_id for update;
  if v_pkg.id is null or v_pkg.customer_id<>v_red.customer_id
  then raise exception '套票紀錄不一致'; end if;
  select * into v_tx from public.transactions
    where id=v_red.transaction_id and organization_id=v_red.organization_id for update;
  v_actor:=public.assert_commerce_checkout_actor(v_red.organization_id,v_red.location_id);
  if v_tx.id is null or v_tx.status<>'VOIDED'
  then raise exception '必須先作廢原始結帳交易才能回補'; end if;
  select id into v_prior from public.package_ledger_entries
    where organization_id=v_red.organization_id and reverses_entry_id=v_red.id;
  if v_prior is not null then return v_prior; end if;
  insert into public.package_ledger_entries(
    organization_id,customer_package_id,customer_id,app_id,type,session_delta,
    service_id,appointment_id,treatment_id,transaction_id,location_id,
    reason,effect_key,reverses_entry_id,created_by_staff_id
  ) values (
    v_red.organization_id,v_red.customer_package_id,v_red.customer_id,
    'pled-'||replace(gen_random_uuid()::text,'-',''),'REVERSAL',1,
    v_red.service_id,v_red.appointment_id,v_red.treatment_id,v_red.transaction_id,
    v_red.location_id,trim(p_reason),'void-reversal:'||v_red.id::text,
    v_red.id,v_actor
  ) returning id into v_new;
  return v_new;
end; $$;

revoke all on function public.restore_voided_package_redemption(uuid,text) from public,anon;
grant execute on function public.restore_voided_package_redemption(uuid,text) to authenticated;
