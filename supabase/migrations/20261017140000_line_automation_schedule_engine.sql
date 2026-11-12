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

create or replace function public.line_automation_schedule_lock_org(
  p_organization_id text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Transaction lock for one organization, including first-insert races.
  perform pg_advisory_xact_lock(87140000, hashtext(p_organization_id));
  perform 1
  from public.line_automation_jobs
  where organization_id = p_organization_id
  order by id
  for update;
end;
$$;

comment on function public.line_automation_schedule_lock_org(text) is
  'Serializes one organization LINE automation schedule apply. Does not send LINE.';

create or replace function public.line_automation_schedule_event_kind(
  p_automation_type text
)
returns text
language sql
immutable
as $$
  select case p_automation_type
    when 'appointment_reminder' then 'appointment'
    when 'birthday_greeting' then 'customer_birthday'
    when 'holiday_greeting' then 'holiday_occurrence'
    when 'satisfaction_survey' then 'treatment'
    when 'coupon_expiry' then 'customer_package'
    else null
  end;
$$;

create or replace function public.line_automation_schedule_timing_allowed(
  p_automation_type text,
  p_timing_id text
)
returns boolean
language sql
immutable
as $$
  select p_timing_id = any(
    case p_automation_type
      when 'appointment_reminder' then array['day_before_morning', 'hours_before_3']
      when 'birthday_greeting' then array['birthday_morning', 'days_before_3']
      when 'holiday_greeting' then array['cny', 'mid_autumn', 'christmas']
      when 'satisfaction_survey' then array['hours_after_2', 'days_after_1']
      when 'coupon_expiry' then array['days_before_7', 'days_before_3', 'days_before_1']
      else '{}'::text[]
    end
  );
$$;

create or replace function public.line_automation_schedule_rule_allows(
  p_organization_id text,
  p_automation_type text,
  p_timing_id text,
  p_message_snapshot text
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_template text;
  v_timing_ids text[];
  v_selected jsonb;
begin
  if to_regclass('public.line_automation_rules') is null then
    raise exception 'missing rule' using errcode = 'P0002';
  end if;

  select
    r.enabled,
    coalesce(r.message_template, ''),
    coalesce(r.timing_ids, '{}'::text[]),
    r.timing_config->'selectedTimingIds'
  into v_enabled, v_template, v_timing_ids, v_selected
  from public.line_automation_rules r
  where r.organization_id = p_organization_id
    and r.automation_type = p_automation_type
  limit 1;

  if not found then
    raise exception 'missing rule' using errcode = 'P0002';
  end if;
  if v_enabled is not true then
    raise exception 'rule disabled' using errcode = '22023';
  end if;
  if jsonb_typeof(v_selected) = 'array' then
    if not exists (
      select 1
      from jsonb_array_elements_text(v_selected) t
      where t = p_timing_id
    ) then
      raise exception 'invalid timing' using errcode = '22023';
    end if;
  elsif not (p_timing_id = any (v_timing_ids)) then
    raise exception 'invalid timing' using errcode = '22023';
  end if;
  if p_message_snapshot is distinct from v_template then
    raise exception 'rule mismatch' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.line_automation_schedule_customer_belongs(
  p_organization_id text,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_customer_id is null or btrim(p_customer_id) = '' then
    return false;
  end if;
  if to_regclass('public.customers') is null or to_regclass('public.organizations') is null then
    return true;
  end if;
  return exists (
    select 1
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where o.app_id = p_organization_id
      and (
        c.app_id = p_customer_id
        or c.id::text = p_customer_id
      )
      and coalesce(c.status::text, 'ACTIVE') = 'ACTIVE'
  );
end;
$$;

create or replace function public.line_automation_schedule_customer_id_matches(
  p_customer_uuid uuid,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_customer_uuid is null or p_customer_id is null or btrim(p_customer_id) = '' then
    return false;
  end if;
  if p_customer_uuid::text = p_customer_id then
    return true;
  end if;
  if to_regclass('public.customers') is null then
    return false;
  end if;
  return exists (
    select 1
    from public.customers c
    where c.id = p_customer_uuid
      and (c.app_id = p_customer_id or c.id::text = p_customer_id)
  );
end;
$$;

create or replace function public.line_automation_schedule_event_belongs(
  p_organization_id text,
  p_automation_type text,
  p_event_kind text,
  p_event_id text,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_event_id is null or btrim(p_event_id) = '' then
    return false;
  end if;
  if not public.line_automation_schedule_customer_belongs(p_organization_id, p_customer_id) then
    return false;
  end if;
  if p_automation_type = 'holiday_greeting' or p_event_kind = 'holiday_occurrence' then
    return false;
  end if;
  if p_automation_type = 'birthday_greeting' then
    return p_event_id = p_customer_id;
  end if;
  if p_automation_type = 'appointment_reminder' then
    if to_regclass('public.appointments') is null then
      return false;
    end if;
    return exists (
      select 1
      from public.appointments a
      join public.organizations o on o.id = a.organization_id
      where o.app_id = p_organization_id
        and (a.app_id = p_event_id or a.id::text = p_event_id)
        and public.line_automation_schedule_customer_id_matches(a.customer_id, p_customer_id)
    );
  end if;
  if p_automation_type = 'satisfaction_survey' then
    if to_regclass('public.treatments') is null then
      return false;
    end if;
    return exists (
      select 1
      from public.treatments t
      join public.organizations o on o.id = t.organization_id
      where o.app_id = p_organization_id
        and (t.app_id = p_event_id or t.id::text = p_event_id)
        and public.line_automation_schedule_customer_id_matches(t.customer_id, p_customer_id)
    );
  end if;
  if p_automation_type = 'coupon_expiry' then
    if to_regclass('public.customer_packages') is null then
      return false;
    end if;
    return exists (
      select 1
      from public.customer_packages p
      join public.organizations o on o.id = p.organization_id
      where o.app_id = p_organization_id
        and (p.app_id = p_event_id or p.id::text = p_event_id)
        and public.line_automation_schedule_customer_id_matches(p.customer_id, p_customer_id)
        and p.status::text = 'ACTIVE'
        and p.expires_at is not null
    );
  end if;
  return false;
end;
$$;

create or replace function public.line_automation_schedule_taipei_morning(
  p_date date
)
returns timestamptz
language sql
immutable
as $$
  select (p_date + time '10:00') at time zone 'Asia/Taipei';
$$;

create or replace function public.line_automation_schedule_next_birthday(
  p_birthday date,
  p_now_taipei date
)
returns date
language plpgsql
immutable
as $$
declare
  v_year int;
  v_month int;
  v_day int;
  v_candidate date;
begin
  if p_birthday is null or p_now_taipei is null then
    return null;
  end if;
  v_year := extract(year from p_now_taipei)::int;
  v_month := extract(month from p_birthday)::int;
  v_day := extract(day from p_birthday)::int;
  if v_month = 2 and v_day = 29
    and not ((v_year % 4 = 0 and v_year % 100 <> 0) or v_year % 400 = 0)
  then
    v_candidate := make_date(v_year, 2, 28);
  else
    v_candidate := make_date(v_year, v_month, v_day);
  end if;
  if v_candidate >= p_now_taipei then
    return v_candidate;
  end if;
  v_year := v_year + 1;
  if v_month = 2 and v_day = 29
    and not ((v_year % 4 = 0 and v_year % 100 <> 0) or v_year % 400 = 0)
  then
    return make_date(v_year, 2, 28);
  end if;
  return make_date(v_year, v_month, v_day);
end;
$$;

create or replace function public.line_automation_schedule_expected_fire_at(
  p_organization_id text,
  p_automation_type text,
  p_event_kind text,
  p_event_id text,
  p_customer_id text,
  p_timing_id text
)
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_start timestamptz;
  v_completed timestamptz;
  v_expires timestamptz;
  v_birthday date;
  v_next date;
  v_now_taipei date;
  v_local timestamp;
  v_days int;
begin
  if not public.line_automation_schedule_timing_allowed(p_automation_type, p_timing_id) then
    return null;
  end if;
  if not public.line_automation_schedule_event_belongs(
    p_organization_id, p_automation_type, p_event_kind, p_event_id, p_customer_id
  ) then
    return null;
  end if;
  v_now_taipei := (timezone('Asia/Taipei', now()))::date;

  if p_automation_type = 'holiday_greeting' then
    return null;
  end if;

  if p_automation_type = 'appointment_reminder' then
    if to_regclass('public.appointments') is null then
      return null;
    end if;
    select a.starts_at
    into v_start
    from public.appointments a
    join public.organizations o on o.id = a.organization_id
    where o.app_id = p_organization_id
      and (a.app_id = p_event_id or a.id::text = p_event_id)
      and public.line_automation_schedule_customer_id_matches(a.customer_id, p_customer_id)
    limit 1;
    if v_start is null then
      return null;
    end if;
    if p_timing_id = 'hours_before_3' then
      return v_start - interval '3 hours';
    end if;
    if p_timing_id = 'day_before_morning' then
      return public.line_automation_schedule_taipei_morning(
        (v_start at time zone 'Asia/Taipei')::date - 1
      );
    end if;
    return null;
  end if;

  if p_automation_type = 'birthday_greeting' then
    if to_regclass('public.customers') is null then
      return null;
    end if;
    select c.birthday
    into v_birthday
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where o.app_id = p_organization_id
      and (c.app_id = p_customer_id or c.id::text = p_customer_id)
    limit 1;
    v_next := public.line_automation_schedule_next_birthday(v_birthday, v_now_taipei);
    if v_next is null then
      return null;
    end if;
    if p_timing_id = 'days_before_3' then
      v_next := v_next - 3;
    elsif p_timing_id is distinct from 'birthday_morning' then
      return null;
    end if;
    return public.line_automation_schedule_taipei_morning(v_next);
  end if;

  if p_automation_type = 'satisfaction_survey' then
    if to_regclass('public.treatments') is null then
      return null;
    end if;
    select t.completed_at
    into v_completed
    from public.treatments t
    join public.organizations o on o.id = t.organization_id
    where o.app_id = p_organization_id
      and (t.app_id = p_event_id or t.id::text = p_event_id)
      and public.line_automation_schedule_customer_id_matches(t.customer_id, p_customer_id)
      and t.status::text = 'COMPLETED'
    limit 1;
    if v_completed is null then
      return null;
    end if;
    if p_timing_id = 'hours_after_2' then
      return v_completed + interval '2 hours';
    end if;
    if p_timing_id = 'days_after_1' then
      v_local := v_completed at time zone 'Asia/Taipei';
      return (v_local::date + 1 + v_local::time) at time zone 'Asia/Taipei';
    end if;
    return null;
  end if;

  if p_automation_type = 'coupon_expiry' then
    if to_regclass('public.customer_packages') is null then
      return null;
    end if;
    select p.expires_at
    into v_expires
    from public.customer_packages p
    join public.organizations o on o.id = p.organization_id
    where o.app_id = p_organization_id
      and (p.app_id = p_event_id or p.id::text = p_event_id)
      and public.line_automation_schedule_customer_id_matches(p.customer_id, p_customer_id)
      and p.status::text = 'ACTIVE'
    limit 1;
    if v_expires is null then
      return null;
    end if;
    v_days := case p_timing_id
      when 'days_before_7' then 7
      when 'days_before_3' then 3
      when 'days_before_1' then 1
      else null
    end;
    if v_days is null then
      return null;
    end if;
    return public.line_automation_schedule_taipei_morning(
      (v_expires at time zone 'Asia/Taipei')::date - v_days
    );
  end if;

  return null;
end;
$$;

create or replace function public.line_automation_schedule_recipient_ready(
  p_organization_id text,
  p_customer_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- Phase 2B scheduled appointment jobs without a customer LINE binding table.
  -- Phase 2A must not invent ready from RPC payload or customers.line_user_id.
  -- A future trusted binding table may confirm ready; missing source stays false.
  if not public.line_automation_schedule_customer_belongs(p_organization_id, p_customer_id) then
    return false;
  end if;
  if to_regclass('public.line_customer_bindings') is null then
    return false;
  end if;
  return exists (
    select 1
    from public.line_customer_bindings b
    join public.organizations o on o.id = b.organization_id
    join public.customers c on c.id = b.customer_id and c.organization_id = o.id
    where o.app_id = p_organization_id
      and (c.app_id = p_customer_id or c.id::text = p_customer_id)
      and b.verified is true
      and coalesce(b.status, 'active') = 'active'
  );
end;
$$;

create or replace function public.line_automation_schedule_apply_recipient(
  p_existing_status text,
  p_confirmed_ready boolean
)
returns table(status text, recipient_ready boolean)
language sql
immutable
as $$
  select
    case
      when p_confirmed_ready then 'scheduled'
      when p_existing_status = 'scheduled' then 'scheduled'
      else 'pending_recipient'
    end,
    p_confirmed_ready is true;
$$;

create or replace function public.line_automation_schedule_assert_job_identity(
  p_organization_id text,
  p_item jsonb,
  p_job public.line_automation_jobs
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_item->>'organization_id' is distinct from p_organization_id
    or p_job.organization_id is distinct from p_organization_id
  then
    raise exception 'job identity mismatch' using errcode = '22023';
  end if;
  if p_item->>'fingerprint' is distinct from p_job.fingerprint then
    raise exception 'job identity mismatch' using errcode = '22023';
  end if;
  if p_item->>'automation_type' is distinct from p_job.automation_type then
    raise exception 'job identity mismatch' using errcode = '22023';
  end if;
  if p_item->>'event_id' is distinct from p_job.event_id
    and p_item->>'event_id' is distinct from p_job.appointment_app_id
  then
    raise exception 'job identity mismatch' using errcode = '22023';
  end if;
  if p_item->>'customer_id' is distinct from p_job.customer_id
    and p_item->>'customer_id' is distinct from p_job.customer_app_id
  then
    raise exception 'job identity mismatch' using errcode = '22023';
  end if;
  if p_item->>'timing_id' is distinct from p_job.timing_id then
    raise exception 'job identity mismatch' using errcode = '22023';
  end if;
end;
$$;

create or replace function public.line_automation_schedule_event_state(
  p_organization_id text,
  p_automation_type text,
  p_event_id text,
  p_customer_id text
)
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_status text;
  v_start timestamptz;
  v_completed timestamptz;
  v_expires timestamptz;
  v_birthday date;
  v_customer_ok boolean;
begin
  if p_automation_type = 'holiday_greeting' then
    return 'incomplete';
  end if;

  if p_automation_type = 'birthday_greeting' then
    if to_regclass('public.customers') is null then
      return 'incomplete';
    end if;
    select
      c.birthday,
      public.line_automation_schedule_customer_belongs(p_organization_id, p_customer_id)
        and (c.app_id = p_customer_id or c.id::text = p_customer_id)
        and p_event_id = p_customer_id
        and coalesce(c.status::text, 'ACTIVE') = 'ACTIVE'
    into v_birthday, v_customer_ok
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where o.app_id = p_organization_id
      and (c.app_id = p_customer_id or c.id::text = p_customer_id)
    limit 1;
    if not found then
      return 'no';
    end if;
    if v_customer_ok is not true then
      return 'no';
    end if;
    if v_birthday is null then
      return 'no';
    end if;
    return 'yes';
  end if;

  if p_automation_type = 'appointment_reminder' then
    if to_regclass('public.appointments') is null then
      return 'incomplete';
    end if;
    select a.status::text, a.starts_at,
      public.line_automation_schedule_customer_id_matches(a.customer_id, p_customer_id)
    into v_status, v_start, v_customer_ok
    from public.appointments a
    join public.organizations o on o.id = a.organization_id
    where o.app_id = p_organization_id
      and (a.app_id = p_event_id or a.id::text = p_event_id)
    limit 1;
    if not found then
      return 'no';
    end if;
    if v_customer_ok is not true then
      return 'no';
    end if;
    if v_start is null then
      return 'incomplete';
    end if;
    if v_status not in ('BOOKED', 'CONFIRMED') then
      return 'no';
    end if;
    return 'yes';
  end if;

  if p_automation_type = 'satisfaction_survey' then
    if to_regclass('public.treatments') is null then
      return 'incomplete';
    end if;
    select t.status::text, t.completed_at,
      public.line_automation_schedule_customer_id_matches(t.customer_id, p_customer_id)
    into v_status, v_completed, v_customer_ok
    from public.treatments t
    join public.organizations o on o.id = t.organization_id
    where o.app_id = p_organization_id
      and (t.app_id = p_event_id or t.id::text = p_event_id)
    limit 1;
    if not found then
      return 'no';
    end if;
    if v_customer_ok is not true then
      return 'no';
    end if;
    if v_status is distinct from 'COMPLETED' then
      return 'no';
    end if;
    if v_completed is null then
      return 'incomplete';
    end if;
    return 'yes';
  end if;

  if p_automation_type = 'coupon_expiry' then
    if to_regclass('public.customer_packages') is null then
      return 'incomplete';
    end if;
    select p.status::text, p.expires_at,
      public.line_automation_schedule_customer_id_matches(p.customer_id, p_customer_id)
    into v_status, v_expires, v_customer_ok
    from public.customer_packages p
    join public.organizations o on o.id = p.organization_id
    where o.app_id = p_organization_id
      and (p.app_id = p_event_id or p.id::text = p_event_id)
    limit 1;
    if not found then
      return 'no';
    end if;
    if v_customer_ok is not true then
      return 'no';
    end if;
    if v_status is distinct from 'ACTIVE' then
      return 'no';
    end if;
    if v_expires is null then
      return 'incomplete';
    end if;
    return 'yes';
  end if;

  return 'incomplete';
end;
$$;

create or replace function public.line_automation_schedule_assert_cancelable(
  p_organization_id text,
  p_job public.line_automation_jobs
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_enabled boolean;
  v_timing_ids text[];
  v_selected jsonb;
  v_state text;
  v_canonical text;
begin
  v_canonical := p_organization_id || '|' || p_job.automation_type || '|' || p_job.event_id || '|' || p_job.timing_id;
  if p_job.fingerprint is distinct from v_canonical then
    raise exception 'invalid fingerprint' using errcode = '22023';
  end if;

  if to_regclass('public.line_automation_rules') is null then
    raise exception 'cancel source incomplete' using errcode = '22023';
  end if;

  select
    r.enabled,
    coalesce(r.timing_ids, '{}'::text[]),
    r.timing_config->'selectedTimingIds'
  into v_enabled, v_timing_ids, v_selected
  from public.line_automation_rules r
  where r.organization_id = p_organization_id
    and r.automation_type = p_job.automation_type
  limit 1;

  if not found or v_enabled is not true then
    return;
  end if;
  if jsonb_typeof(v_selected) = 'array' then
    if not exists (
      select 1
      from jsonb_array_elements_text(v_selected) t
      where t = p_job.timing_id
    ) then
      return;
    end if;
  elsif not (p_job.timing_id = any (v_timing_ids)) then
    return;
  end if;

  v_state := public.line_automation_schedule_event_state(
    p_organization_id,
    p_job.automation_type,
    p_job.event_id,
    p_job.customer_id
  );
  if v_state = 'incomplete' then
    raise exception 'cancel source incomplete' using errcode = '22023';
  end if;
  if v_state = 'no' then
    return;
  end if;
  raise exception 'cancel not allowed' using errcode = '22023';
end;
$$;

create or replace function public.line_automation_schedule_validate_item(
  p_organization_id text,
  p_item jsonb
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_type text;
  v_kind text;
  v_event_id text;
  v_customer_id text;
  v_timing text;
  v_fp text;
  v_scheduled timestamptz;
  v_expected timestamptz;
begin
  if p_item is null or jsonb_typeof(p_item) <> 'object' then
    raise exception 'invalid schedule item' using errcode = '22023';
  end if;
  if p_item->>'organization_id' is distinct from p_organization_id then
    raise exception 'organization mismatch' using errcode = '42501';
  end if;
  v_type := p_item->>'automation_type';
  v_kind := p_item->>'event_kind';
  v_event_id := nullif(btrim(coalesce(p_item->>'event_id', '')), '');
  v_customer_id := nullif(btrim(coalesce(p_item->>'customer_id', '')), '');
  v_timing := p_item->>'timing_id';
  v_fp := p_item->>'fingerprint';
  if public.line_automation_schedule_event_kind(v_type) is null then
    raise exception 'invalid automation' using errcode = '22023';
  end if;
  if v_kind is distinct from public.line_automation_schedule_event_kind(v_type) then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if not public.line_automation_schedule_timing_allowed(v_type, v_timing) then
    raise exception 'invalid timing' using errcode = '22023';
  end if;
  if v_event_id is null then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  if v_customer_id is null then
    raise exception 'invalid customer' using errcode = '22023';
  end if;
  if v_fp is distinct from (p_organization_id || '|' || v_type || '|' || v_event_id || '|' || v_timing) then
    raise exception 'invalid fingerprint' using errcode = '22023';
  end if;
  if v_type = 'holiday_greeting' then
    raise exception 'holiday source missing' using errcode = '22023';
  end if;
  if v_type = 'coupon_expiry' and to_regclass('public.customer_packages') is null then
    raise exception 'coupon source missing' using errcode = '22023';
  end if;
  if not public.line_automation_schedule_customer_belongs(p_organization_id, v_customer_id) then
    raise exception 'invalid customer' using errcode = '22023';
  end if;
  if not public.line_automation_schedule_event_belongs(
    p_organization_id, v_type, v_kind, v_event_id, v_customer_id
  ) then
    raise exception 'invalid event' using errcode = '22023';
  end if;
  perform public.line_automation_schedule_rule_allows(
    p_organization_id,
    v_type,
    v_timing,
    coalesce(p_item->>'message_snapshot', '')
  );
  if p_item ? 'status'
    and p_item->>'status' not in ('scheduled', 'pending_recipient') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  begin
    v_scheduled := (p_item->>'scheduled_for')::timestamptz;
  exception
    when others then
      raise exception 'invalid scheduled_for' using errcode = '22023';
  end;
  v_expected := public.line_automation_schedule_expected_fire_at(
    p_organization_id, v_type, v_kind, v_event_id, v_customer_id, v_timing
  );
  if v_expected is null or v_scheduled is distinct from v_expected then
    raise exception 'invalid scheduled_for' using errcode = '22023';
  end if;
end;
$$;

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
  v_ready boolean;
  v_existing public.line_automation_jobs%rowtype;
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

  perform public.line_automation_schedule_lock_org(p_organization_id);

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'cancel', '[]'::jsonb))
  loop
    if v_item->>'organization_id' is distinct from p_organization_id then
      raise exception 'organization mismatch' using errcode = '42501';
    end if;
    select *
    into v_existing
    from public.line_automation_jobs
    where organization_id = p_organization_id
      and id = v_item->>'id'
    for update;
    if not found then
      continue;
    end if;
    if v_existing.status not in ('scheduled', 'pending_recipient') then
      continue;
    end if;
    if nullif(btrim(coalesce(v_item->>'fingerprint', '')), '') is distinct from v_existing.fingerprint then
      raise exception 'invalid fingerprint' using errcode = '22023';
    end if;
    perform public.line_automation_schedule_assert_cancelable(p_organization_id, v_existing);
    update public.line_automation_jobs
    set
      status = 'canceled',
      skip_reason = 'schedule_recomputed',
      updated_at = now()
    where organization_id = p_organization_id
      and id = v_existing.id
      and fingerprint = v_existing.fingerprint
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
    select *
    into v_existing
    from public.line_automation_jobs
    where organization_id = p_organization_id
      and id = v_item->>'id'
    for update;
    if not found then
      raise exception 'invalid job' using errcode = '22023';
    end if;
    if v_existing.status not in ('scheduled', 'pending_recipient') then
      continue;
    end if;
    perform public.line_automation_schedule_assert_job_identity(
      p_organization_id, v_item, v_existing
    );
    perform public.line_automation_schedule_validate_item(
      p_organization_id,
      jsonb_strip_nulls(
        jsonb_build_object(
          'organization_id', p_organization_id,
          'automation_type', v_existing.automation_type,
          'event_kind', coalesce(v_existing.event_kind, public.line_automation_schedule_event_kind(v_existing.automation_type)),
          'event_id', v_existing.event_id,
          'customer_id', v_existing.customer_id,
          'timing_id', v_existing.timing_id,
          'fingerprint', p_organization_id || '|' || v_existing.automation_type || '|' || v_existing.event_id || '|' || v_existing.timing_id,
          'scheduled_for', v_item->>'scheduled_for',
          'message_snapshot', coalesce(v_item->>'message_snapshot', v_existing.message_snapshot, ''),
          'status', v_item->>'status'
        )
      )
    );
    v_customer_id := v_existing.customer_id;
    v_ready := public.line_automation_schedule_recipient_ready(p_organization_id, v_customer_id);
    select s.status, s.recipient_ready
    into v_status, v_ready
    from public.line_automation_schedule_apply_recipient(v_existing.status, v_ready) s;
    update public.line_automation_jobs
    set
      scheduled_for = (v_item->>'scheduled_for')::timestamptz,
      message_snapshot = coalesce(v_item->>'message_snapshot', message_snapshot),
      recipient_ready = v_ready,
      status = v_status,
      skip_reason = null,
      updated_at = now()
    where organization_id = p_organization_id
      and id = v_existing.id
      and fingerprint = v_existing.fingerprint
      and automation_type = v_existing.automation_type
      and event_id = v_existing.event_id
      and customer_id = v_existing.customer_id
      and timing_id = v_existing.timing_id
      and status in ('scheduled', 'pending_recipient');
    if found then
      v_updated := v_updated + 1;
    end if;
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_mutations->'insert', '[]'::jsonb))
  loop
    perform public.line_automation_schedule_validate_item(p_organization_id, v_item);
    v_fp := v_item->>'fingerprint';
    v_event_id := v_item->>'event_id';
    v_customer_id := v_item->>'customer_id';
    v_ready := public.line_automation_schedule_recipient_ready(p_organization_id, v_customer_id);
    if exists (
      select 1
      from public.line_automation_jobs
      where organization_id = p_organization_id
        and fingerprint = v_fp
        and status in (
          'accepted', 'pending_confirmation', 'reconciled', 'claimed',
          'scheduled', 'pending_recipient'
        )
    ) then
      continue;
    end if;
    v_status := case when v_ready then 'scheduled' else 'pending_recipient' end;
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
      v_ready
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

revoke all on function public.line_automation_schedule_lock_org(text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_event_kind(text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_timing_allowed(text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_rule_allows(text, text, text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_customer_belongs(text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_customer_id_matches(uuid, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_event_belongs(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_taipei_morning(date) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_next_birthday(date, date) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_expected_fire_at(text, text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_recipient_ready(text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_apply_recipient(text, boolean) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_assert_job_identity(text, jsonb, public.line_automation_jobs) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_event_state(text, text, text, text) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_assert_cancelable(text, public.line_automation_jobs) from public, anon, authenticated;
revoke all on function public.line_automation_schedule_validate_item(text, jsonb) from public, anon, authenticated;
