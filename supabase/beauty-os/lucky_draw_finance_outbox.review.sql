-- Finance database only. No historical backfill. Capture all status changes; worker verifies purchase evidence.
begin;
create table public.lucky_draw_finance_outbox (
 transaction_id uuid primary key references public.transactions(id),
 organization_id uuid not null,
 revision bigint not null default 1,
 desired_status text not null check(desired_status in ('COMPLETED','VOIDED')),
 state text not null default 'pending' check(state in ('pending','done','review')),
 attempts integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 last_code text
);
alter table public.lucky_draw_finance_outbox enable row level security;
revoke all on public.lucky_draw_finance_outbox from public,anon,authenticated;
grant select,update on public.lucky_draw_finance_outbox to service_role;
create index lucky_draw_finance_outbox_pending_idx on public.lucky_draw_finance_outbox(next_attempt_at) where state='pending';
create or replace function public.lucky_draw_capture_finance_event()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status::text not in ('COMPLETED','VOIDED') then return new; end if;
 if tg_op='UPDATE' then
  if old.status is not distinct from new.status then return new; end if;
 end if;
 insert into public.lucky_draw_finance_outbox(transaction_id,organization_id,desired_status)
 values(new.id,new.organization_id,new.status::text)
 on conflict(transaction_id) do update set
 revision=public.lucky_draw_finance_outbox.revision+1,
 desired_status=excluded.desired_status,state='pending',attempts=0,
 next_attempt_at=now(),updated_at=now(),last_code=null;
 return new;
end; $$;
revoke all on function public.lucky_draw_capture_finance_event() from public,anon,authenticated;
create trigger lucky_draw_capture_finance_event after insert or update of status on public.transactions
 for each row execute function public.lucky_draw_capture_finance_event();
commit;
