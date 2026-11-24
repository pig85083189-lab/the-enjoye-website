-- REVIEW ONLY. Install together with grant/reversal integration.
begin;
create table lucky_draw_private.spend_cancellations(
 organization_id uuid not null,
 source_key text not null,
 cancelled_at timestamptz not null default now(),
 primary key(organization_id,source_key)
);
alter table lucky_draw_private.spend_cancellations enable row level security;
revoke all on lucky_draw_private.spend_cancellations from public,anon,authenticated,service_role;
create function lucky_draw_private.lock_spend(p_org uuid,p_key text)
returns void language sql set search_path='' as $$
 select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_org::text||':'||p_key,0));
$$;
revoke all on function lucky_draw_private.lock_spend(uuid,text) from public,anon,authenticated,service_role;
create function public.lucky_draw_mark_spend_cancelled(p_org uuid,p_key text)
returns void language plpgsql security definer set search_path='' as $$
begin
 if coalesce(auth.jwt()->>'role','')<>'service_role' then raise exception 'FORBIDDEN'; end if;
 if p_org is null or p_key is null or p_key !~ '^(booking|finance):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then raise exception 'INVALID_KEY'; end if;
 perform lucky_draw_private.lock_spend(p_org,p_key);
 insert into lucky_draw_private.spend_cancellations(organization_id,source_key) values(p_org,p_key) on conflict do nothing;
end; $$;
revoke all on function public.lucky_draw_mark_spend_cancelled(uuid,text) from public,anon,authenticated;
grant execute on function public.lucky_draw_mark_spend_cancelled(uuid,text) to service_role;
commit;
