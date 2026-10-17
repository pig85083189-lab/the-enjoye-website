-- LINE automation schedule engine. Additive upgrade of existing line_automation_jobs.
-- Reuses the Phase 2B jobs table (off this chain; commit 9144e66 /
-- 20261013120000_line_appointment_reminder_automation.sql when present).
-- Does not DROP TABLE, DROP COLUMN, TRUNCATE, or DELETE existing rows.
-- Does not CREATE OR REPLACE / DROP Phase 2B reminder RPCs.
-- Does not open send, create a scheduled worker, or call the LINE Messaging API.
-- Do not apply on Production until Owner confirms.

create table if not exists public.line_automation_jobs (
  id text primary key,
  organization_id text not null,
  appointment_app_id text,
  customer_app_id text,
  service_app_id text,
  timing_id text not null,
  fingerprint text not null,
  scheduled_for timestamptz not null,
  status text not null default 'scheduled',
  request_id text not null,
  claimed_at timestamptz,
  send_claimed_at timestamptz,
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.line_automation_jobs is
  'Pending LINE automation jobs. Phase 2A only inserts, updates, or cancels unsent rows. It does not send LINE.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_jobs' and column_name = 'automation_type'
  ) then
    alter table public.line_automation_jobs add column automation_type text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_jobs' and column_name = 'event_kind'
  ) then
    alter table public.line_automation_jobs add column event_kind text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_jobs' and column_name = 'event_id'
  ) then
    alter table public.line_automation_jobs add column event_id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_jobs' and column_name = 'customer_id'
  ) then
    alter table public.line_automation_jobs add column customer_id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_jobs' and column_name = 'message_snapshot'
  ) then
    alter table public.line_automation_jobs add column message_snapshot text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_jobs' and column_name = 'recipient_ready'
  ) then
    alter table public.line_automation_jobs add column recipient_ready boolean;
  end if;
end $$;

update public.line_automation_jobs
set automation_type = 'appointment_reminder'
where automation_type is null;

update public.line_automation_jobs
set event_kind = 'appointment'
where event_kind is null
  and appointment_app_id is not null;

update public.line_automation_jobs
set event_id = appointment_app_id
where event_id is null
  and appointment_app_id is not null;

update public.line_automation_jobs
set customer_id = customer_app_id
where customer_id is null
  and customer_app_id is not null;

update public.line_automation_jobs
set customer_app_id = customer_id
where customer_app_id is null
  and customer_id is not null;

update public.line_automation_jobs
set message_snapshot = ''
where message_snapshot is null;

update public.line_automation_jobs
set recipient_ready = false
where recipient_ready is null;

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'line_automation_jobs'
      and column_name = 'appointment_app_id'
      and is_nullable = 'NO'
  ) then
    alter table public.line_automation_jobs
      alter column appointment_app_id drop not null;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from public.line_automation_jobs
    where automation_type is null
       or event_id is null
       or customer_id is null
       or message_snapshot is null
       or recipient_ready is null
  ) then
    alter table public.line_automation_jobs
      alter column automation_type set not null;
    alter table public.line_automation_jobs
      alter column event_id set not null;
    alter table public.line_automation_jobs
      alter column customer_id set not null;
    alter table public.line_automation_jobs
      alter column message_snapshot set not null;
    alter table public.line_automation_jobs
      alter column recipient_ready set not null;
  end if;
end $$;

alter table public.line_automation_jobs drop constraint if exists line_automation_jobs_org_prefix;
alter table public.line_automation_jobs drop constraint if exists line_automation_jobs_type_check;
alter table public.line_automation_jobs drop constraint if exists line_automation_jobs_event_kind_check;
alter table public.line_automation_jobs drop constraint if exists line_automation_jobs_timing_check;
alter table public.line_automation_jobs drop constraint if exists line_automation_jobs_status_check;
alter table public.line_automation_jobs drop constraint if exists line_automation_jobs_id_prefix;

alter table public.line_automation_jobs
  add constraint line_automation_jobs_org_prefix
    check (organization_id like 'org-%');

alter table public.line_automation_jobs
  add constraint line_automation_jobs_id_prefix
    check (id like 'laj-%');

alter table public.line_automation_jobs
  add constraint line_automation_jobs_type_check
    check (
      automation_type in (
        'appointment_reminder',
        'birthday_greeting',
        'holiday_greeting',
        'satisfaction_survey',
        'coupon_expiry'
      )
    );

alter table public.line_automation_jobs
  add constraint line_automation_jobs_event_kind_check
    check (
      event_kind is null
      or event_kind in (
        'appointment',
        'customer_birthday',
        'holiday_occurrence',
        'treatment',
        'customer_package'
      )
    );

alter table public.line_automation_jobs
  add constraint line_automation_jobs_timing_check
    check (
      timing_id in (
        'day_before_morning',
        'hours_before_3',
        'birthday_morning',
        'days_before_3',
        'cny',
        'mid_autumn',
        'christmas',
        'hours_after_2',
        'days_after_1',
        'days_before_7',
        'days_before_1'
      )
    );

alter table public.line_automation_jobs
  add constraint line_automation_jobs_status_check
    check (
      status in (
        'scheduled',
        'pending_recipient',
        'claimed',
        'accepted',
        'failed',
        'canceled',
        'expired',
        'skipped',
        'pending_confirmation',
        'reconciled'
      )
    );

create unique index if not exists line_automation_jobs_active_fingerprint_key
  on public.line_automation_jobs (organization_id, fingerprint)
  where status in ('scheduled', 'pending_recipient', 'claimed');

create index if not exists line_automation_jobs_org_status_fire_idx
  on public.line_automation_jobs (organization_id, status, scheduled_for);

create index if not exists line_automation_jobs_org_event_idx
  on public.line_automation_jobs (organization_id, automation_type, event_id);

alter table public.line_automation_jobs enable row level security;

revoke all on public.line_automation_jobs from anon, authenticated, public;
grant select on public.line_automation_jobs to authenticated;

drop policy if exists line_automation_jobs_select_owner
  on public.line_automation_jobs;
create policy line_automation_jobs_select_owner
on public.line_automation_jobs
for select
to authenticated
using (public.user_is_org_owner(organization_id));

create or replace function public.read_line_automation_schedule(
  p_organization_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'jobs', coalesce(
      (
        select jsonb_agg(to_jsonb(j) order by j.scheduled_for, j.id)
        from public.line_automation_jobs j
        where j.organization_id = p_organization_id
      ),
      '[]'::jsonb
    ),
    'sent_line', false
  );
end;
$$;

comment on function public.read_line_automation_schedule(text) is
  'Owner-only read of one organization LINE automation jobs. Does not send LINE.';

create or replace function public.apply_line_automation_schedule(
  p_organization_id text,
  p_mutations jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_inserted int := 0;
  v_updated int := 0;
  v_canceled int := 0;
  v_status text;
  v_id text;
  v_fp text;
  v_event_id text;
  v_customer_id text;
begin
  if auth.uid() is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  if p_mutations is null or jsonb_typeof(p_mutations) <> 'object' then
    raise exception 'invalid mutations' using errcode = '22023';
  end if;
  if coalesce(p_mutations->>'organization_id', p_organization_id) is distinct from p_organization_id then
    raise exception 'organization mismatch' using errcode = '42501';
  end if;

  perform 1
  from public.line_automation_jobs
  where organization_id = p_organization_id
  for update;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'cancel', '[]'::jsonb))
  loop
    if v_item->>'organization_id' is distinct from p_organization_id then
      raise exception 'organization mismatch' using errcode = '42501';
    end if;
    update public.line_automation_jobs
    set
      status = 'canceled',
      skip_reason = 'schedule_recomputed',
      updated_at = now()
    where organization_id = p_organization_id
      and id = v_item->>'id'
      and status in ('scheduled', 'pending_recipient');
    if found then
      v_canceled := v_canceled + 1;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'update', '[]'::jsonb))
  loop
    if v_item->>'organization_id' is distinct from p_organization_id then
      raise exception 'organization mismatch' using errcode = '42501';
    end if;
    v_status := case
      when coalesce((v_item->>'recipient_ready')::boolean, false) then 'scheduled'
      else 'pending_recipient'
    end;
    update public.line_automation_jobs
    set
      automation_type = v_item->>'automation_type',
      event_kind = v_item->>'event_kind',
      event_id = v_item->>'event_id',
      appointment_app_id = case
        when v_item->>'event_kind' = 'appointment' then v_item->>'event_id'
        else appointment_app_id
      end,
      customer_id = v_item->>'customer_id',
      customer_app_id = v_item->>'customer_id',
      timing_id = v_item->>'timing_id',
      fingerprint = v_item->>'fingerprint',
      scheduled_for = (v_item->>'scheduled_for')::timestamptz,
      message_snapshot = coalesce(v_item->>'message_snapshot', ''),
      recipient_ready = coalesce((v_item->>'recipient_ready')::boolean, false),
      status = v_status,
      skip_reason = null,
      updated_at = now()
    where organization_id = p_organization_id
      and id = v_item->>'id'
      and status in ('scheduled', 'pending_recipient');
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'insert', '[]'::jsonb))
  loop
    if v_item->>'organization_id' is distinct from p_organization_id then
      raise exception 'organization mismatch' using errcode = '42501';
    end if;
    v_fp := v_item->>'fingerprint';
    v_event_id := v_item->>'event_id';
    v_customer_id := v_item->>'customer_id';
    if v_fp is null or v_event_id is null or v_customer_id is null then
      continue;
    end if;
    if exists (
      select 1
      from public.line_automation_jobs
      where organization_id = p_organization_id
        and fingerprint = v_fp
        and status in ('accepted', 'pending_confirmation', 'reconciled', 'claimed')
    ) then
      continue;
    end if;
    v_status := case
      when coalesce((v_item->>'recipient_ready')::boolean, false) then 'scheduled'
      else 'pending_recipient'
    end;
    v_id := coalesce(
      nullif(v_item->>'id', ''),
      'laj-' || substr(md5(p_organization_id || ':' || v_fp), 1, 20)
    );
    insert into public.line_automation_jobs (
      id,
      organization_id,
      automation_type,
      event_kind,
      event_id,
      appointment_app_id,
      customer_id,
      customer_app_id,
      timing_id,
      fingerprint,
      scheduled_for,
      status,
      request_id,
      message_snapshot,
      recipient_ready
    ) values (
      v_id,
      p_organization_id,
      v_item->>'automation_type',
      v_item->>'event_kind',
      v_event_id,
      case when v_item->>'event_kind' = 'appointment' then v_event_id else null end,
      v_customer_id,
      v_customer_id,
      v_item->>'timing_id',
      v_fp,
      (v_item->>'scheduled_for')::timestamptz,
      v_status,
      coalesce(nullif(v_item->>'request_id', ''), 'lajq-' || substr(md5(v_fp || ':' || coalesce(v_item->>'scheduled_for', '')), 1, 16)),
      coalesce(v_item->>'message_snapshot', ''),
      coalesce((v_item->>'recipient_ready')::boolean, false)
    )
    on conflict (organization_id, fingerprint)
    where status in ('scheduled', 'pending_recipient', 'claimed')
    do update set
      scheduled_for = excluded.scheduled_for,
      message_snapshot = excluded.message_snapshot,
      recipient_ready = excluded.recipient_ready,
      status = case
        when public.line_automation_jobs.status = 'claimed' then public.line_automation_jobs.status
        else excluded.status
      end,
      skip_reason = null,
      updated_at = now()
    where public.line_automation_jobs.status in ('scheduled', 'pending_recipient');
    if found then
      v_inserted := v_inserted + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'inserted', v_inserted,
    'updated', v_updated,
    'canceled', v_canceled,
    'sent_line', false
  );
end;
$$;

comment on function public.apply_line_automation_schedule(text, jsonb) is
  'Owner-only apply of pending LINE automation jobs. Inserts, updates, or cancels unsent rows only. Does not send LINE.';

revoke all on function public.read_line_automation_schedule(text) from public, anon;
grant execute on function public.read_line_automation_schedule(text) to authenticated;

revoke all on function public.apply_line_automation_schedule(text, jsonb) from public, anon;
grant execute on function public.apply_line_automation_schedule(text, jsonb) to authenticated;
