-- Apply separately to each transaction database after review.
create table public.member_points_outbox (
 transaction_id uuid primary key references public.transactions(id),
 organization_id uuid not null references public.organizations(id),
 revision bigint not null default 1,
 desired_status text not null check(desired_status in ('COMPLETED','VOIDED')),
 state text not null default 'pending' check(state in ('pending','done','review')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_code text
);
alter table public.member_points_outbox enable row level security;
revoke all on public.member_points_outbox from public,anon,authenticated;
grant select,insert,update on public.member_points_outbox to service_role;
create index member_points_outbox_due_idx on public.member_points_outbox(next_attempt_at) where state='pending';
create function public.member_points_capture_event() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status::text not in ('COMPLETED','VOIDED') then return new; end if;
 if tg_op='UPDATE' then
  if old.status is not distinct from new.status then return new; end if;
 end if;
 insert into public.member_points_outbox(transaction_id,organization_id,desired_status)
 values(new.id,new.organization_id,new.status::text)
 on conflict(transaction_id) do update set revision=public.member_points_outbox.revision+1,
 desired_status=excluded.desired_status,state='pending',attempts=0,next_attempt_at=now(),updated_at=now(),last_code=null;
 return new;
end $$;
revoke all on function public.member_points_capture_event() from public,anon,authenticated;
create trigger member_points_capture_event after insert or update of status on public.transactions
for each row execute function public.member_points_capture_event();
-- No backfill. Existing reward triggers are unchanged.
