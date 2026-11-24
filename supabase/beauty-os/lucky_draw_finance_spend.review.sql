-- Review only. Do not install until identity, refund and integration tests pass.
begin;
create or replace function public.lucky_draw_grant_finance_purchase(p_org uuid,p_transaction uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare t public.transactions%rowtype; c public.lucky_draw_campaigns%rowtype; n bigint; threshold bigint;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 perform lucky_draw_private.lock_spend(p_org,'finance:'||p_transaction::text);
 if exists(select 1 from lucky_draw_private.spend_cancellations where organization_id=p_org and source_key='finance:'||p_transaction::text) then return null; end if;
 select * into t from public.transactions where id=p_transaction and organization_id=p_org for update;
 if not found or t.status::text<>'COMPLETED' or t.voided_at is not null or t.completed_at is null or t.total_minor<=0 then return null; end if;
 -- Only finance-native package purchases, never wallet mirror or top-up.
 if not exists(select 1 from public.customer_packages p join public.package_ledger_entries e on e.customer_package_id=p.id and e.organization_id=p.organization_id and e.customer_id=p.customer_id where p.organization_id=p_org and p.customer_id=t.customer_id and p.purchase_transaction_id=t.id and e.transaction_id=t.id and e.type::text='PURCHASE') then return null; end if;
 select * into c from public.lucky_draw_campaigns where organization_id=p_org and status='active' and (t.completed_at at time zone 'Asia/Taipei')::date between starts_on and ends_on and (now() at time zone 'Asia/Taipei')::date between starts_on and ends_on and t.completed_at>=published_at for update;
 if not found or c.rules->'spend'->>'enabled' is distinct from 'true' then return null; end if;
 threshold=(c.rules->'spend'->>'amountMinor')::bigint;
 if threshold is null or threshold<=0 then raise exception 'INVALID_THRESHOLD'; end if;
 select coalesce(sum(amount_minor),0) into n from public.transaction_payments where organization_id=p_org and transaction_id=t.id and method::text in ('CASH','CARD','TRANSFER','STORED_VALUE');
 if n<>t.total_minor then return null; end if;
 n=n/threshold;
 if n<=0 then return null; end if;
 if n>2147483647 then raise exception 'INVALID_QUANTITY'; end if;
 perform lucky_draw_private.assert_line_member(p_org,t.customer_id);
 return lucky_draw_private.apply_chance_delta(p_org,t.customer_id,c.id,'spend','finance:'||t.id::text,n::integer,null,'package_purchase');
end; $$;
revoke all on function public.lucky_draw_grant_finance_purchase(uuid,uuid) from public,anon,authenticated;
grant execute on function public.lucky_draw_grant_finance_purchase(uuid,uuid) to service_role;
commit;
