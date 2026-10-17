-- Local-only Phase 2B schema stub for the Phase 1 upgrade integration test.
-- Never connect to Preview or Production. Never call LINE.

create schema if not exists auth;
create schema if not exists tests;

create or replace function auth.uid()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.current_uid', true), '')::uuid;
$$;

create or replace function tests.become(p_uid uuid)
returns void
language plpgsql
as $$
begin
  perform set_config('app.current_uid', p_uid::text, false);
end;
$$;

create or replace function public.is_auth_uuid(value text)
returns boolean
language sql
immutable
as $$
  select value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
$$;

create or replace function public.is_operational_staff_id(value text)
returns boolean
language sql
immutable
as $$
  select value is not null
    and length(btrim(value)) > 0
    and not public.is_auth_uuid(value);
$$;

create table if not exists public.organizations (
  id uuid primary key,
  name text not null,
  app_id text not null unique
);

create table if not exists public.staff_auth_memberships (
  id text primary key,
  user_id text not null,
  auth_user_id uuid,
  organization_id text not null,
  role text not null,
  display_name text not null,
  is_active boolean not null default true
);

create or replace function public.user_is_org_owner(target_org_app_id text)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.staff_auth_memberships m
    where m.organization_id = target_org_app_id
      and m.auth_user_id = auth.uid()
      and m.is_active = true
      and m.role = 'OWNER'
  );
$$;

-- Preview live signature. Do not add a text overload.
create or replace function public.user_operational_staff_id(target_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.user_id
  from public.staff_auth_memberships m
  join public.organizations o on o.app_id = m.organization_id
  where o.id = target_org
    and m.auth_user_id = auth.uid()
    and m.is_active = true
  limit 1;
$$;

comment on function public.user_operational_staff_id(uuid) is
  'Preview-compatible staff id lookup. Argument is organizations.id, not app_id.';

create table if not exists public.line_automation_rules (
  organization_id text not null,
  automation_id text not null,
  enabled boolean not null default false,
  timing_ids text[] not null default '{}',
  template text not null default '',
  updated_by_staff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, automation_id),
  constraint line_automation_rules_org_prefix check (organization_id like 'org-%'),
  constraint line_automation_rules_id_check check (automation_id = 'appointment_reminder'),
  constraint line_automation_rules_timing_check
    check (timing_ids <@ array['day_before_morning', 'hours_before_3']::text[]),
  constraint line_automation_rules_updater_operational
    check (
      updated_by_staff_id is null
      or public.is_operational_staff_id(updated_by_staff_id)
    )
);

create table if not exists public.line_automation_jobs (
  id text primary key,
  organization_id text not null,
  appointment_app_id text not null,
  customer_app_id text not null,
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
  updated_at timestamptz not null default now(),
  constraint line_automation_jobs_timing_check
    check (timing_id in ('day_before_morning', 'hours_before_3')),
  constraint line_automation_jobs_status_check
    check (
      status in (
        'scheduled', 'claimed', 'accepted', 'failed', 'canceled',
        'expired', 'skipped', 'pending_confirmation', 'reconciled'
      )
    ),
  constraint line_automation_jobs_id_org_key unique (id, organization_id)
);

create or replace function public.upsert_line_appointment_reminder_rule(
  p_organization_id text,
  p_enabled boolean,
  p_timing_ids text[],
  p_template text,
  p_updated_by_staff_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;

  insert into public.line_automation_rules (
    organization_id, automation_id, enabled, timing_ids, template, updated_by_staff_id
  ) values (
    p_organization_id, 'appointment_reminder', coalesce(p_enabled, false),
    coalesce(p_timing_ids, '{}'), coalesce(p_template, ''), p_updated_by_staff_id
  )
  on conflict (organization_id, automation_id)
  do update set
    enabled = excluded.enabled,
    timing_ids = excluded.timing_ids,
    template = excluded.template,
    updated_by_staff_id = excluded.updated_by_staff_id,
    updated_at = now();

  update public.line_automation_jobs
  set status = 'canceled',
      skip_reason = case
        when coalesce(p_enabled, false) is not true then 'rule_disabled'
        else 'timing_disabled'
      end,
      updated_at = now()
  where organization_id = p_organization_id
    and status = 'scheduled'
    and (
      coalesce(p_enabled, false) is not true
      or not (timing_id = any (coalesce(p_timing_ids, '{}'::text[])))
    );

  return jsonb_build_object('ok', true, 'organization_id', p_organization_id, 'persisted', true);
end;
$$;

create or replace function public.read_line_appointment_reminder_workspace(
  p_organization_id text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_rule public.line_automation_rules%rowtype;
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_rule
  from public.line_automation_rules
  where organization_id = p_organization_id
    and automation_id = 'appointment_reminder';

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'enabled', coalesce(v_rule.enabled, false),
    'timing_ids', coalesce(v_rule.timing_ids, '{}'),
    'template', coalesce(v_rule.template, ''),
    'saved', v_rule.organization_id is not null
  );
end;
$$;

create or replace function public.sync_line_appointment_reminder_jobs(
  p_organization_id text,
  p_appointment_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rule public.line_automation_rules%rowtype;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;

  select * into v_rule
  from public.line_automation_rules
  where organization_id = p_organization_id
    and automation_id = 'appointment_reminder';

  update public.line_automation_jobs
  set status = 'canceled',
      skip_reason = 'fingerprint_changed',
      updated_at = now()
  where organization_id = p_organization_id
    and appointment_app_id = p_appointment_app_id
    and status in ('scheduled');

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'appointment_app_id', p_appointment_app_id,
    'rule_enabled', coalesce(v_rule.enabled, false)
  );
end;
$$;

insert into public.organizations (id, name, app_id) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'THE ENJOYE', 'org-the-enjoye');

insert into public.staff_auth_memberships (
  id, user_id, auth_user_id, organization_id, role, display_name, is_active
) values (
  'mem-enjoye-owner',
  'staff-enjoye-owner',
  '11111111-1111-1111-1111-111111111111',
  'org-the-enjoye',
  'OWNER',
  '享悅店長',
  true
);

insert into public.line_automation_rules (
  organization_id, automation_id, enabled, timing_ids, template, updated_by_staff_id
) values (
  'org-the-enjoye',
  'appointment_reminder',
  true,
  array['day_before_morning', 'hours_before_3']::text[],
  '舊預約提醒範本，請勿覆蓋',
  'staff-enjoye-owner'
);

insert into public.line_automation_jobs (
  id, organization_id, appointment_app_id, customer_app_id, service_app_id,
  timing_id, fingerprint, scheduled_for, status, request_id
) values
  (
    'laj-keep-day', 'org-the-enjoye', 'appt-keep', 'cust-1', 'svc-1',
    'day_before_morning', 'fp-keep-day', now() + interval '1 day',
    'scheduled', 'larq-keep-day'
  ),
  (
    'laj-remove-hours', 'org-the-enjoye', 'appt-keep', 'cust-1', 'svc-1',
    'hours_before_3', 'fp-remove-hours', now() + interval '3 hours',
    'scheduled', 'larq-remove-hours'
  ),
  (
    'laj-other-appt', 'org-the-enjoye', 'appt-other', 'cust-2', 'svc-1',
    'day_before_morning', 'fp-other', now() + interval '2 day',
    'scheduled', 'larq-other-appt'
  );
