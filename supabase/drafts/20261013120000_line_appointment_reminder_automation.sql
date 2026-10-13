-- =============================================================================
-- DRAFT ONLY — Beauty OS LINE appointment reminder (Phase 2A)
-- Do NOT apply to Preview or Production.
-- Do NOT copy into supabase/migrations/ until Owner confirms.
-- Additive. Reuses organizations.app_id, user_is_org_owner, LINE channel lock.
-- Does not invent a second Organization / Appointment / Customer / token store.
-- customers.line_user_id remains CRM plaintext and is never a send destination.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Verified customer LINE bindings (independent of line_owner_recipients)
-- ---------------------------------------------------------------------------
create table if not exists public.line_customer_bindings (
  organization_id text not null,
  customer_app_id text not null,
  line_user_id_cipher text not null,
  line_user_id_hint text not null,
  key_id text not null,
  verified boolean not null default false,
  bind_method text not null default 'unverified',
  bound_at timestamptz,
  unbound_at timestamptz,
  blocked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_app_id),
  constraint line_customer_bindings_org_prefix
    check (organization_id like 'org-%'),
  constraint line_customer_bindings_cipher_prefix
    check (line_user_id_cipher like 'v1.%'),
  constraint line_customer_bindings_hint_prefix
    check (line_user_id_hint like '••••%'),
  constraint line_customer_bindings_method_check
    check (bind_method in ('unverified', 'webhook_code')),
  constraint line_customer_bindings_verified_bound
    check (verified = false or bound_at is not null)
);

comment on table public.line_customer_bindings is
  'Verified customer LINE user bindings. Encrypted userId only. Never reuse customers.line_user_id or line_owner_recipients.';

create unique index if not exists idx_line_customer_bindings_active_hint
  on public.line_customer_bindings (organization_id, line_user_id_hint)
  where unbound_at is null and verified = true;

create index if not exists idx_line_customer_bindings_org_verified
  on public.line_customer_bindings (organization_id, verified)
  where unbound_at is null;

-- ---------------------------------------------------------------------------
-- Notification preferences (fail closed: opt-in default false)
-- ---------------------------------------------------------------------------
create table if not exists public.line_notification_preferences (
  organization_id text not null,
  customer_app_id text not null,
  appointment_reminder_opt_in boolean not null default false,
  unsubscribed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_app_id),
  constraint line_notification_preferences_org_prefix
    check (organization_id like 'org-%')
);

comment on table public.line_notification_preferences is
  'Per-customer notification consent. Appointment reminders require explicit opt-in and no unsubscribe.';

-- ---------------------------------------------------------------------------
-- Automation rules (Owner-managed, default disabled)
-- ---------------------------------------------------------------------------
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
  constraint line_automation_rules_org_prefix
    check (organization_id like 'org-%'),
  constraint line_automation_rules_id_check
    check (automation_id = 'appointment_reminder'),
  constraint line_automation_rules_timing_check
    check (
      timing_ids <@ array['day_before_morning', 'hours_before_3']::text[]
    ),
  constraint line_automation_rules_updater_operational
    check (
      updated_by_staff_id is null
      or public.is_operational_staff_id(updated_by_staff_id)
    )
);

comment on table public.line_automation_rules is
  'Owner automation rules. Phase 2A allows appointment_reminder only. Default enabled=false.';

-- ---------------------------------------------------------------------------
-- Jobs
-- ---------------------------------------------------------------------------
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
  constraint line_automation_jobs_id_prefix check (id like 'laj-%'),
  constraint line_automation_jobs_org_prefix check (organization_id like 'org-%'),
  constraint line_automation_jobs_request_prefix check (request_id like 'larq-%'),
  constraint line_automation_jobs_timing_check
    check (timing_id in ('day_before_morning', 'hours_before_3')),
  constraint line_automation_jobs_status_check
    check (
      status in (
        'scheduled',
        'claimed',
        'accepted',
        'failed',
        'canceled',
        'expired',
        'skipped',
        'pending_confirmation'
      )
    )
);

comment on table public.line_automation_jobs is
  'Appointment reminder jobs. Past-due jobs expire; timeout stays pending_confirmation and must not auto-retry.';

create unique index if not exists idx_line_automation_jobs_request
  on public.line_automation_jobs (request_id);

create unique index if not exists idx_line_automation_jobs_active_unique
  on public.line_automation_jobs (organization_id, appointment_app_id, timing_id)
  where status in ('scheduled', 'claimed');

create index if not exists idx_line_automation_jobs_due
  on public.line_automation_jobs (organization_id, scheduled_for, status)
  where status = 'scheduled';

-- ---------------------------------------------------------------------------
-- Deliveries
-- ---------------------------------------------------------------------------
create table if not exists public.line_automation_deliveries (
  id text primary key,
  organization_id text not null,
  job_id text not null references public.line_automation_jobs (id),
  request_id text not null,
  status text not null,
  line_request_id text,
  http_status integer,
  error_class text,
  message text,
  created_at timestamptz not null default now(),
  constraint line_automation_deliveries_id_prefix check (id like 'lad-%'),
  constraint line_automation_deliveries_org_prefix check (organization_id like 'org-%'),
  constraint line_automation_deliveries_request_prefix check (request_id like 'larq-%'),
  constraint line_automation_deliveries_status_check
    check (status in ('accepted', 'failed', 'pending_confirmation', 'skipped')),
  constraint line_automation_deliveries_org_job_match
    check (true)
);

comment on table public.line_automation_deliveries is
  'Personal Push outcomes. Never store LINE response bodies or plaintext userIds.';

create unique index if not exists idx_line_automation_deliveries_request
  on public.line_automation_deliveries (request_id);

create index if not exists idx_line_automation_deliveries_org_created
  on public.line_automation_deliveries (organization_id, created_at desc);

-- ---------------------------------------------------------------------------
-- RLS: Owner read own org. No authenticated writes. No secret grants.
-- ---------------------------------------------------------------------------
alter table public.line_customer_bindings enable row level security;
alter table public.line_notification_preferences enable row level security;
alter table public.line_automation_rules enable row level security;
alter table public.line_automation_jobs enable row level security;
alter table public.line_automation_deliveries enable row level security;

revoke all on public.line_customer_bindings from public, anon, authenticated;
revoke all on public.line_notification_preferences from public, anon, authenticated;
revoke all on public.line_automation_rules from public, anon, authenticated;
revoke all on public.line_automation_jobs from public, anon, authenticated;
revoke all on public.line_automation_deliveries from public, anon, authenticated;

grant select on public.line_automation_rules to authenticated;
grant select on public.line_automation_jobs to authenticated;
grant select on public.line_automation_deliveries to authenticated;
grant select on public.line_notification_preferences to authenticated;
-- Bindings expose hint only via view-less SELECT of non-cipher columns is still
-- too wide if cipher is on the same table. Authenticated gets no SELECT here.

create policy line_automation_rules_select_owner
on public.line_automation_rules
for select to authenticated
using (public.user_is_org_owner(organization_id));

create policy line_automation_jobs_select_owner
on public.line_automation_jobs
for select to authenticated
using (public.user_is_org_owner(organization_id));

create policy line_automation_deliveries_select_owner
on public.line_automation_deliveries
for select to authenticated
using (public.user_is_org_owner(organization_id));

create policy line_notification_preferences_select_owner
on public.line_notification_preferences
for select to authenticated
using (public.user_is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Owner rule upsert. Application persist flag remains closed this phase.
-- ---------------------------------------------------------------------------
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
    raise exception 'unauthorized';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization';
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

  return jsonb_build_object('ok', true, 'organization_id', p_organization_id);
end;
$$;

revoke all on function public.upsert_line_appointment_reminder_rule(text, boolean, text[], text, text)
  from public, anon;
grant execute on function public.upsert_line_appointment_reminder_rule(text, boolean, text[], text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic claim. Shares LINE Channel advisory lock with Broadcast.
-- Timeout / pending_confirmation rows are never reclaimed.
-- ---------------------------------------------------------------------------
create or replace function public.claim_line_appointment_reminder_job(
  p_organization_id text,
  p_request_id text,
  p_quota_known boolean,
  p_quota_remaining integer,
  p_quota_checked_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.line_automation_jobs;
  v_channel_id text;
  v_lock_key bigint;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_request_id is null or p_request_id not like 'larq-%' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select channel_id into v_channel_id
  from public.line_official_accounts
  where organization_id = p_organization_id;

  if v_channel_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_configured');
  end if;

  v_lock_key := ('x' || substr(md5('line-channel-lock:' || v_channel_id), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(870121, (v_lock_key % 2147483647)::int);

  if exists (
    select 1
    from public.line_broadcasts b
    where b.status in ('sending', 'pending_confirmation')
      and exists (
        select 1 from public.line_official_accounts a
        where a.organization_id = b.organization_id
          and a.channel_id = v_channel_id
      )
  ) or exists (
    select 1
    from public.line_automation_jobs j
    where j.status in ('claimed', 'pending_confirmation')
      and exists (
        select 1 from public.line_official_accounts a
        where a.organization_id = j.organization_id
          and a.channel_id = v_channel_id
      )
  ) then
    return jsonb_build_object('ok', false, 'reason', 'pending_confirmation');
  end if;

  if p_quota_known is not true then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;
  if p_quota_remaining is not null and p_quota_remaining <= 0 then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;
  if p_quota_checked_at is null or p_quota_checked_at < now() - interval '30 seconds' then
    return jsonb_build_object('ok', false, 'reason', 'quota_exceeded');
  end if;

  select * into v_job
  from public.line_automation_jobs
  where organization_id = p_organization_id
    and request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status in ('accepted', 'failed', 'canceled', 'expired', 'skipped')
     or v_job.send_claimed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status in ('claimed', 'pending_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'pending_confirmation');
  end if;
  if v_job.status <> 'scheduled' then
    return jsonb_build_object('ok', false, 'reason', 'send_closed');
  end if;
  if v_job.scheduled_for > now() then
    return jsonb_build_object('ok', false, 'reason', 'send_closed');
  end if;
  if v_job.scheduled_for < now() - interval '20 minutes' then
    update public.line_automation_jobs
    set status = 'expired', skip_reason = 'expired_window', updated_at = now()
    where id = v_job.id;
    return jsonb_build_object('ok', false, 'reason', 'send_closed');
  end if;

  update public.line_automation_jobs
  set status = 'claimed',
      claimed_at = now(),
      send_claimed_at = now(),
      updated_at = now()
  where id = v_job.id
    and status = 'scheduled'
    and send_claimed_at is null
  returning * into v_job;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  return jsonb_build_object(
    'ok', true,
    'request_id', v_job.request_id,
    'job_id', v_job.id
  );
end;
$$;

revoke all on function public.claim_line_appointment_reminder_job(text, text, boolean, integer, timestamptz)
  from public, anon, authenticated;

create or replace function public.complete_line_appointment_reminder_job(
  p_organization_id text,
  p_request_id text,
  p_status text,
  p_line_request_id text,
  p_http_status integer,
  p_error_class text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.line_automation_jobs;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_status not in ('accepted', 'failed', 'pending_confirmation', 'skipped', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select * into v_job
  from public.line_automation_jobs
  where organization_id = p_organization_id
    and request_id = p_request_id
  for update;

  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status in ('accepted', 'pending_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  update public.line_automation_jobs
  set status = p_status,
      updated_at = now()
  where id = v_job.id;

  insert into public.line_automation_deliveries (
    id, organization_id, job_id, request_id, status,
    line_request_id, http_status, error_class, message
  ) values (
    'lad-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_organization_id, v_job.id, p_request_id, p_status,
    p_line_request_id, p_http_status, p_error_class, left(coalesce(p_message, ''), 200)
  )
  on conflict (request_id) do nothing;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

revoke all on function public.complete_line_appointment_reminder_job(text, text, text, text, integer, text, text)
  from public, anon, authenticated;
