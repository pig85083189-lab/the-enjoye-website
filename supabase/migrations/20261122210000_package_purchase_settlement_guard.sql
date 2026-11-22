-- Fail closed: a generic checkout must never settle PACKAGE_PURCHASE
-- without creating the matching package ledger credit in the same transaction.
-- This trigger runs on transaction INSERT, before any payment/ledger posting.
create or replace function public.guard_atomic_package_purchase_settlement()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $$
declare
  v_draft public.checkout_drafts;
  v_def public.package_definitions;
  v_item public.checkout_items;
begin
  if new.checkout_draft_id is null then return new; end if;
  select * into v_draft from public.checkout_drafts
    where id=new.checkout_draft_id and organization_id=new.organization_id;
  if v_draft.id is null then return new; end if;
  if not exists(select 1 from public.checkout_items
    where checkout_draft_id=v_draft.id and type='PACKAGE_PURCHASE') then
    return new;
  end if;
  if current_setting('beauty_os.atomic_package_purchase',true)
      is distinct from v_draft.id::text then
    raise exception '套票購買必須使用原子結帳入口';
  end if;
  if (select count(*) from public.checkout_items
      where checkout_draft_id=v_draft.id)<>1 then
    raise exception '套票購買不可與其他項目混合';
  end if;
  select * into v_item from public.checkout_items
    where checkout_draft_id=v_draft.id and type='PACKAGE_PURCHASE';
  select * into v_def from public.package_definitions
    where id::text=current_setting('beauty_os.atomic_package_definition',true)
      and organization_id=new.organization_id and is_active=true;
  if v_def.id is null or v_item.reference_id is distinct from v_def.app_id
     or v_item.quantity<>1 or v_item.session_count_snapshot is distinct from v_def.session_count
     or v_item.unit_price_minor is distinct from v_def.price_minor
     or v_item.line_subtotal_minor is distinct from v_def.price_minor
     or v_item.line_total_minor is distinct from v_def.price_minor
     or v_item.discount_amount_minor is distinct from 0
     or v_draft.subtotal_minor is distinct from v_def.price_minor
     or v_draft.discount_total_minor is distinct from 0
     or v_draft.total_minor is distinct from v_def.price_minor
     or new.customer_id is distinct from v_draft.customer_id
  then raise exception '套票購買交易資料不一致'; end if;
  return new;
end; $$;

drop trigger if exists trg_atomic_package_purchase_guard on public.transactions;
create trigger trg_atomic_package_purchase_guard
before insert on public.transactions for each row
execute function public.guard_atomic_package_purchase_settlement();

revoke all on function public.guard_atomic_package_purchase_settlement()
from public,anon,authenticated;
comment on function public.guard_atomic_package_purchase_settlement()
is 'Reject generic PACKAGE_PURCHASE settlement without dedicated atomic purchase context.';
