-- Review only: caller must independently read authoritative booking settlement
-- and verify current booking LINE identity. No browser access.
begin;
create or replace function public.lucky_draw_grant_booking_spend(
 p_org uuid,p_booking_org uuid,p_booking_customer uuid,p_transaction uuid,
 p_amount bigint,p_completed_at timestamptz,p_verified_hash text,p_expected_customer uuid)
returns bigint language plpgsql security definer set search_path='' as $$
declare c public.lucky_draw_campaigns%rowtype; v_customer uuid; n bigint; threshold bigint; matches bigint;
begin
 if coalesce(auth.jwt()->>'role','') <> 'service_role' then raise exception 'FORBIDDEN'; end if;
 perform lucky_draw_private.lock_spend(p_org,'booking:'||p_transaction::text);
 if exists(select 1 from lucky_draw_private.spend_cancellations where organization_id=p_org and source_key='booking:'||p_transaction::text) then return null; end if;
 if p_transaction is null or p_amount is null or p_amount<=0 or p_completed_at is null or p_completed_at>now() then return null; end if;
 lock table public.member_booking_finance_identity_links,public.member_finance_binding_challenges,public.customer_wallet_identities,public.member_line_customer_links,public.line_customer_bindings in share mode;
 select count(*) into matches from public.member_booking_finance_identity_links l
 where l.organization_id=p_org and l.booking_organization_id=p_booking_org and l.booking_customer_id=p_booking_customer and l.revoked_at is null;
 if matches>1 then return null; end if;
 if p_verified_hash is null or p_verified_hash !~ '^[0-9a-f]{64}$'
 or p_expected_customer is null then return null; end if;
 if matches=0 then
  if exists(select 1 from public.member_booking_finance_identity_links where organization_id=p_org and (booking_customer_id=p_booking_customer or finance_customer_id=p_expected_customer)) or exists(select 1 from public.member_finance_binding_challenges where organization_id=p_org and line_subject_hash=p_verified_hash) or exists(select 1 from public.customer_wallet_identities where organization_id=p_org and (booking_customer_id=p_expected_customer or wallet_customer_id=p_expected_customer)) then return null; end if;
  if (select count(*) from public.member_line_customer_links where organization_id=p_org and line_subject_hash=p_verified_hash)<>1 then return null; end if;
  select customer_id into v_customer from public.member_line_customer_links where organization_id=p_org and line_subject_hash=p_verified_hash and verified_at is not null;
 else
 select l.finance_customer_id into v_customer from public.member_booking_finance_identity_links l
 join public.member_finance_binding_challenges b on b.id=l.finance_confirmation_id and b.organization_id=l.organization_id and b.confirmed_customer_id=l.finance_customer_id
 where l.organization_id=p_org and l.booking_organization_id=p_booking_org and l.booking_customer_id=p_booking_customer and l.revoked_at is null and b.status='CONFIRMED' and b.confirmed_at is not null;
 end if;
 if v_customer is distinct from p_expected_customer then return null; end if;
 if not exists(select 1 from public.member_line_customer_links where organization_id=p_org and customer_id=v_customer and line_subject_hash=p_verified_hash and verified_at is not null) then return null; end if;
 select * into c from public.lucky_draw_campaigns where organization_id=p_org and status='active'
 and (p_completed_at at time zone 'Asia/Taipei')::date between starts_on and ends_on
 and (now() at time zone 'Asia/Taipei')::date between starts_on and ends_on
 and p_completed_at>=published_at for update;
 if not found or c.rules->'spend'->>'enabled' is distinct from 'true' then return null; end if;
 threshold=(c.rules->'spend'->>'amountMinor')::bigint;
 if threshold is null or threshold<=0 then raise exception 'INVALID_THRESHOLD'; end if;
 n=p_amount/threshold;
 if n<=0 then return null; end if;
 if n>2147483647 then raise exception 'INVALID_QUANTITY'; end if;
 perform lucky_draw_private.assert_line_member(p_org,v_customer);
 return lucky_draw_private.apply_chance_delta(p_org,v_customer,c.id,'spend','booking:'||p_transaction::text,n::integer,null,'booking_checkout');
end; $$;
revoke all on function public.lucky_draw_grant_booking_spend(uuid,uuid,uuid,uuid,bigint,timestamptz,text,uuid) from public,anon,authenticated;
grant execute on function public.lucky_draw_grant_booking_spend(uuid,uuid,uuid,uuid,bigint,timestamptz,text,uuid) to service_role;
commit;
