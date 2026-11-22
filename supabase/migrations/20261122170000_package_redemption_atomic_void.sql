-- Opt-in cancellation for zero-value package redemptions only.
-- Paid checkout void/refund is intentionally out of scope.
create or replace function public.void_package_redemption_checkout(
  p_transaction_id uuid,
  p_reason text
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $$
declare
  v_tx public.transactions;
  v_entry public.package_ledger_entries;
  v_reversal uuid;
  v_actor text;
begin
  if auth.uid() is null then raise exception '沒有權限取消結帳'; end if;
  if nullif(trim(coalesce(p_reason,'')),'') is null then
    raise exception '請填寫取消原因'; end if;
  select * into v_tx from public.transactions
    where id=p_transaction_id for update;
  if v_tx.id is null then raise exception '找不到交易'; end if;
  v_actor := public.assert_commerce_checkout_actor(v_tx.organization_id,v_tx.location_id);
  if v_tx.status='VOIDED' then
    select e.* into v_entry from public.package_ledger_entries e
      where e.transaction_id=v_tx.id and e.organization_id=v_tx.organization_id
        and e.type='REDEMPTION';
    if v_entry.id is null then raise exception '此交易不是套票扣堂'; end if;
    select id into v_reversal from public.package_ledger_entries
      where organization_id=v_tx.organization_id and reverses_entry_id=v_entry.id
        and type='REVERSAL';
    if v_reversal is null then raise exception '已取消交易缺少回補紀錄'; end if;
    return jsonb_build_object('transactionId',v_tx.id::text,'reversalId',v_reversal::text,'alreadyVoided',true);
  end if;
  if v_tx.status<>'COMPLETED' or v_tx.total_minor<>0
    or exists(select 1 from public.transaction_payments where transaction_id=v_tx.id)
    or exists(select 1 from public.transaction_items where transaction_id=v_tx.id and type<>'SERVICE')
    or (select count(*) from public.transaction_items where transaction_id=v_tx.id)<>1
  then raise exception '只允許取消零元套票扣堂交易'; end if;
  select * into v_entry from public.package_ledger_entries
    where organization_id=v_tx.organization_id and transaction_id=v_tx.id
      and type='REDEMPTION' for update;
  if v_entry.id is null then raise exception '找不到套票扣堂紀錄'; end if;
  if v_tx.package_redemption is null or
     v_tx.package_redemption->>'customerPackageId' is distinct from
       (select app_id from public.customer_packages where id=v_entry.customer_package_id) or
     v_tx.package_redemption->>'serviceId' is distinct from
       (select app_id from public.services where id=v_entry.service_id) or
     (v_tx.package_redemption->>'sessions')::integer is distinct from 1
  then raise exception '交易套票快照與扣堂紀錄不符'; end if;
  if (select count(*) from public.package_ledger_entries
      where organization_id=v_tx.organization_id and transaction_id=v_tx.id
        and type='REDEMPTION')<>1 then raise exception '扣堂紀錄數量異常'; end if;
  v_reversal := public.restore_package_redemption_internal(
    v_entry.id,p_reason,'void-package-redemption:'||v_entry.id::text
  );
  update public.transactions
    set status='VOIDED',
        voided_at=now(),
        voided_by=v_actor,
        void_reason=trim(p_reason)
    where id=v_tx.id;
  -- Keep the checkout status aligned with its voided transaction.
  update public.checkout_drafts
    set status='VOIDED', updated_at=now()
    where id=v_tx.checkout_draft_id and organization_id=v_tx.organization_id
      and status='COMPLETED';
  return jsonb_build_object('transactionId',v_tx.id::text,'reversalId',v_reversal::text,'alreadyVoided',false);
end; $$;

revoke all on function public.void_package_redemption_checkout(uuid,text) from public,anon;
grant execute on function public.void_package_redemption_checkout(uuid,text) to authenticated;
comment on function public.void_package_redemption_checkout(uuid,text)
is 'Atomically voids a zero-value redeemed service checkout and restores one session; does not process refunds.';
