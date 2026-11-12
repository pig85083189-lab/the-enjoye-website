-- Local-only Preview leftover LINE bind schema for the 161000 upgrade.
-- Matches the observed Preview leftover shape and counts:
--   line_customer_bindings: no id, PK (organization_id, customer_app_id),
--     1 row verified=true for org-beauty-os-test / cust-2d2-fake-bound,
--     ciphertext in line_user_id_cipher
--   line_customer_bind_challenges: 0 rows, id like lcc-%, customer_app_id
--   line_automation_jobs: 11 rows
--   line_automation_rules: 1 row
-- Never connect to Preview or Production. Never call LINE.

create extension if not exists pgcrypto;

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

create table if not exists public.customers (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  app_id text,
  status text not null default 'ACTIVE',
  birthday date,
  full_name text,
  preferred_name text,
  line_user_id text
);

create table if not exists public.appointments (
  id uuid primary key,
  organization_id uuid not null references public.organizations (id),
  customer_id uuid not null references public.customers (id),
  app_id text,
  status text not null default 'BOOKED',
  starts_at timestamptz
);

-- Preview Phase 2B rule shape. One appointment_reminder row.
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
    check (timing_ids <@ array['day_before_morning', 'hours_before_3']::text[])
);

-- Preview Phase 2B jobs plus leftover recipient_ready flags.
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
  recipient_ready boolean not null default false,
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

-- Actual Preview bind shape: no id, leftover PK, ciphertext on the row.
create table if not exists public.line_customer_bindings (
  organization_id text not null,
  customer_app_id text not null,
  line_user_id_hint text not null,
  line_user_id_hash text not null,
  line_user_id_cipher text not null,
  key_id text,
  verified boolean not null default false,
  status text not null default 'active',
  bound_at timestamptz,
  unbound_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_app_id),
  constraint line_customer_bindings_org_prefix check (organization_id like 'org-%')
);

-- Actual Preview challenge shape: lcc-% ids, customer_app_id, no confirm columns.
create table if not exists public.line_customer_bind_challenges (
  id text primary key,
  organization_id text not null,
  customer_app_id text not null,
  staff_user_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  failed_attempts integer not null default 0,
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  constraint line_customer_bind_challenges_id_prefix check (id like 'lcc-%'),
  constraint line_customer_bind_challenges_org_prefix check (organization_id like 'org-%')
);

create unique index if not exists line_customer_bind_challenges_one_open_legacy
  on public.line_customer_bind_challenges (organization_id, customer_app_id)
  where consumed_at is null;

grant select on public.line_customer_bindings to public;

create or replace function public.start_line_customer_bind_challenge(
  p_organization_id text,
  p_customer_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('legacy', true, 'organization_id', p_organization_id, 'customer_app_id', p_customer_app_id);
end;
$$;

-- Actual Preview leftover RPCs that share new identities but still use
-- p_customer_app_id. CREATE OR REPLACE of the new p_customer_id names
-- fails with 42P13 unless 161000 drops them first without CASCADE.
create or replace function public.line_customer_binding_resolve(
  p_organization_id text,
  p_customer_app_id text
)
returns table(customer_app_id text, customer_uuid uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return query
    select c.app_id, c.id
    from public.customers c
    join public.organizations o on o.id = c.organization_id
    where o.app_id = p_organization_id
      and c.app_id = p_customer_app_id
    limit 1;
end;
$$;

create or replace function public.confirm_line_customer_binding(
  p_organization_id text,
  p_customer_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'legacy', true,
    'organization_id', p_organization_id,
    'customer_app_id', p_customer_app_id,
    'verified', true
  );
end;
$$;

create or replace function public.unbind_line_customer_binding(
  p_organization_id text,
  p_customer_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object(
    'legacy', true,
    'organization_id', p_organization_id,
    'customer_app_id', p_customer_app_id,
    'bound', false
  );
end;
$$;

create or replace function public.line_automation_send_recipient_allowed(
  p_organization_id text,
  p_customer_app_id text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  return false;
end;
$$;

create or replace function public.consume_line_customer_bind_challenge_public(
  p_organization_id text,
  p_public_token text,
  p_code text,
  p_event_id text,
  p_line_user_id_cipher text,
  p_line_user_id_hint text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  return jsonb_build_object('legacy', true, 'captured', false);
end;
$$;

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
  select * into v_rule
  from public.line_automation_rules
  where organization_id = p_organization_id
    and automation_id = 'appointment_reminder';
  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'appointment_app_id', p_appointment_app_id,
    'rule_enabled', coalesce(v_rule.enabled, false)
  );
end;
$$;

insert into public.organizations (id, name, app_id) values
  ('dddddddd-dddd-dddd-dddd-dddddddddddd', 'Beauty OS Test', 'org-beauty-os-test'),
  ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'THE ENJOYE', 'org-the-enjoye');

insert into public.staff_auth_memberships (
  id, user_id, auth_user_id, organization_id, role, display_name, is_active
) values
  (
    'mem-test-owner', 'staff-test-owner',
    '11111111-1111-1111-1111-111111111111',
    'org-beauty-os-test', 'OWNER', 'TEST 店長', true
  ),
  (
    'mem-enjoye-owner', 'staff-enjoye-owner',
    '33333333-3333-3333-3333-333333333333',
    'org-the-enjoye', 'OWNER', '享悅店長', true
  );

insert into public.customers (
  id, organization_id, app_id, status, birthday, full_name, preferred_name, line_user_id
) values
  (
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cust-2d2-fake-bound', 'ACTIVE', '1990-10-20', '測試綁定', '測試綁定',
    'Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'cust-unbound', 'ACTIVE', '1990-11-01', '尚未綁定', '尚未綁定',
    null
  ),
  (
    'cccccccc-cccc-cccc-cccc-cccccccccccc',
    'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    'cust-enjoye', 'ACTIVE', '1990-12-01', '享悅顧客', '享悅顧客',
    null
  );

insert into public.appointments (id, organization_id, customer_id, app_id, status, starts_at) values
  (
    '99999999-9999-9999-9999-999999999999',
    'dddddddd-dddd-dddd-dddd-dddddddddddd',
    'eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee',
    'appt-keep', 'BOOKED', timestamptz '2026-10-20 08:00:00+00'
  );

insert into public.line_automation_rules (
  organization_id, automation_id, enabled, timing_ids, template, updated_by_staff_id
) values (
  'org-beauty-os-test',
  'appointment_reminder',
  true,
  array['day_before_morning', 'hours_before_3']::text[],
  '舊預約提醒範本，請勿覆蓋',
  'staff-test-owner'
);

insert into public.line_automation_jobs (
  id, organization_id, appointment_app_id, customer_app_id, service_app_id,
  timing_id, fingerprint, scheduled_for, status, request_id, recipient_ready
) values
  (
    'laj-ready-day', 'org-beauty-os-test', 'appt-keep', 'cust-2d2-fake-bound', 'svc-1',
    'day_before_morning', 'fp-ready-day', now() + interval '1 day',
    'scheduled', 'larq-ready-day', true
  ),
  (
    'laj-ready-hours', 'org-beauty-os-test', 'appt-keep', 'cust-2d2-fake-bound', 'svc-1',
    'hours_before_3', 'fp-ready-hours', now() + interval '3 hours',
    'scheduled', 'larq-ready-hours', true
  ),
  (
    'laj-sched-false', 'org-beauty-os-test', 'appt-keep', 'cust-2d2-fake-bound', 'svc-1',
    'day_before_morning', 'fp-sched-false', now() + interval '2 day',
    'scheduled', 'larq-sched-false', false
  ),
  (
    'laj-claimed', 'org-beauty-os-test', 'appt-keep', 'cust-2d2-fake-bound', 'svc-1',
    'hours_before_3', 'fp-claimed', now() + interval '4 hours',
    'claimed', 'larq-claimed', true
  ),
  (
    'laj-accepted', 'org-beauty-os-test', 'appt-keep', 'cust-2d2-fake-bound', 'svc-1',
    'day_before_morning', 'fp-accepted', now() + interval '5 hours',
    'accepted', 'larq-accepted', false
  ),
  (
    'laj-canceled', 'org-beauty-os-test', 'appt-other', 'cust-2d2-fake-bound', 'svc-1',
    'day_before_morning', 'fp-canceled', now() + interval '6 hours',
    'canceled', 'larq-canceled', false
  ),
  (
    'laj-skipped', 'org-beauty-os-test', 'appt-other', 'cust-2d2-fake-bound', 'svc-1',
    'hours_before_3', 'fp-skipped', now() + interval '7 hours',
    'skipped', 'larq-skipped', false
  ),
  (
    'laj-failed', 'org-beauty-os-test', 'appt-other', 'cust-2d2-fake-bound', 'svc-1',
    'day_before_morning', 'fp-failed', now() + interval '8 hours',
    'failed', 'larq-failed', false
  ),
  (
    'laj-pending-conf', 'org-beauty-os-test', 'appt-other', 'cust-2d2-fake-bound', 'svc-1',
    'hours_before_3', 'fp-pending-conf', now() + interval '9 hours',
    'pending_confirmation', 'larq-pending-conf', false
  ),
  (
    'laj-reconciled', 'org-beauty-os-test', 'appt-other', 'cust-2d2-fake-bound', 'svc-1',
    'day_before_morning', 'fp-reconciled', now() + interval '10 hours',
    'reconciled', 'larq-reconciled', false
  ),
  (
    'laj-expired', 'org-beauty-os-test', 'appt-other', 'cust-2d2-fake-bound', 'svc-1',
    'hours_before_3', 'fp-expired', now() + interval '11 hours',
    'expired', 'larq-expired', false
  );

insert into public.line_customer_bindings (
  organization_id, customer_app_id,
  line_user_id_hint, line_user_id_hash, line_user_id_cipher, key_id,
  verified, status, bound_at
) values (
  'org-beauty-os-test',
  'cust-2d2-fake-bound',
  '••••aaaa',
  encode(sha256(convert_to('Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 'utf8')), 'hex'),
  'v1.cipher-preview-legacy',
  'line-cred-v1',
  true,
  'active',
  timestamptz '2026-09-01 00:00:00+00'
);

create table if not exists public.line_webhook_events (
  organization_id text not null,
  event_id text not null,
  processed_at timestamptz not null default now(),
  bound boolean not null default false,
  primary key (organization_id, event_id)
);

create or replace function tests.line_customer_bind_proof(
  p_organization_id text,
  p_public_token text,
  p_event_id text,
  p_code text,
  p_user_id_hash text,
  p_cipher text,
  p_hint text,
  p_key_id text,
  p_hmac_key text,
  p_issued_at timestamptz
)
returns text
language sql
stable
as $$
  select encode(
    hmac(
      convert_to(
        'line-customer-bind-v1' || chr(10)
        || p_organization_id || chr(10)
        || p_public_token || chr(10)
        || p_event_id || chr(10)
        || p_code || chr(10)
        || p_user_id_hash || chr(10)
        || p_cipher || chr(10)
        || p_hint || chr(10)
        || p_key_id || chr(10)
        || floor(extract(epoch from p_issued_at))::text,
        'utf8'
      ),
      decode(p_hmac_key, 'hex'),
      'sha256'
    ),
    'hex'
  );
$$;
