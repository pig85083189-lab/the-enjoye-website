-- =============================================================================
-- Beauty OS LINE appointment reminder (Phase 2B)
-- Preview-ready formal migration. Do not apply to Preview or Production
-- from this agent. Owner approval is required before any remote apply.
-- Reuses organizations.app_id, user_is_org_owner, LINE channel lock 870121.
-- customers.line_user_id remains CRM plaintext and is never a send destination.
-- Unique customer LINE identity is sha256(org || ':' || userId), never the mask hint.
-- =============================================================================

create table if not exists public.line_customer_bind_challenges (
  id text primary key,
  organization_id text not null,
  customer_app_id text not null,
  code_hash text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint line_customer_bind_challenges_id_prefix check (id like 'lcc-%'),
  constraint line_customer_bind_challenges_org_prefix check (organization_id like 'org-%'),
  constraint line_customer_bind_challenges_hash_len check (length(code_hash) = 64)
);

create index if not exists idx_line_customer_bind_challenges_open
  on public.line_customer_bind_challenges (organization_id, customer_app_id)
  where consumed_at is null;

create table if not exists public.line_customer_bindings (
  organization_id text not null,
  customer_app_id text not null,
  line_user_id_cipher text not null,
  line_user_id_hash text not null,
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
  constraint line_customer_bindings_org_prefix check (organization_id like 'org-%'),
  constraint line_customer_bindings_cipher_prefix check (line_user_id_cipher like 'v1.%'),
  constraint line_customer_bindings_hash_len check (length(line_user_id_hash) = 64),
  constraint line_customer_bindings_hint_prefix check (line_user_id_hint like '••••%'),
  constraint line_customer_bindings_method_check
    check (bind_method in ('unverified', 'webhook_code')),
  constraint line_customer_bindings_verified_bound
    check (verified = false or bound_at is not null)
);

comment on table public.line_customer_bindings is
  'Verified customer LINE bindings. Unique identity is line_user_id_hash, never the display hint.';

create unique index if not exists idx_line_customer_bindings_active_hash
  on public.line_customer_bindings (organization_id, line_user_id_hash)
  where unbound_at is null and verified = true;

create index if not exists idx_line_customer_bindings_org_verified
  on public.line_customer_bindings (organization_id, verified)
  where unbound_at is null;

create table if not exists public.line_notification_preferences (
  organization_id text not null,
  customer_app_id text not null,
  appointment_reminder_opt_in boolean not null default false,
  unsubscribed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (organization_id, customer_app_id),
  constraint line_notification_preferences_org_prefix check (organization_id like 'org-%')
);

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
  constraint line_automation_jobs_id_prefix check (id like 'laj-%'),
  constraint line_automation_jobs_org_prefix check (organization_id like 'org-%'),
  constraint line_automation_jobs_request_prefix check (request_id like 'larq-%'),
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

create unique index if not exists idx_line_automation_jobs_request
  on public.line_automation_jobs (request_id);

create unique index if not exists idx_line_automation_jobs_active_unique
  on public.line_automation_jobs (organization_id, appointment_app_id, timing_id)
  where status in ('scheduled', 'claimed');

create index if not exists idx_line_automation_jobs_due
  on public.line_automation_jobs (organization_id, scheduled_for, status)
  where status = 'scheduled';

create table if not exists public.line_automation_deliveries (
  id text primary key,
  organization_id text not null,
  job_id text not null,
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
    check (status in ('accepted', 'failed', 'pending_confirmation', 'skipped', 'dry_run', 'reconciled')),
  constraint line_automation_deliveries_job_org_fkey
    foreign key (job_id, organization_id)
    references public.line_automation_jobs (id, organization_id)
);

create unique index if not exists idx_line_automation_deliveries_request
  on public.line_automation_deliveries (request_id);

create index if not exists idx_line_automation_deliveries_org_created
  on public.line_automation_deliveries (organization_id, created_at desc);

create table if not exists public.line_automation_dry_runs (
  id text primary key,
  organization_id text not null,
  job_id text,
  request_id text,
  eligible boolean not null,
  skip_reason text,
  message text not null,
  created_at timestamptz not null default now(),
  constraint line_automation_dry_runs_id_prefix check (id like 'ldr-%'),
  constraint line_automation_dry_runs_org_prefix check (organization_id like 'org-%')
);

create index if not exists idx_line_automation_dry_runs_org_created
  on public.line_automation_dry_runs (organization_id, created_at desc);

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = 'line_official_accounts') then
    begin
      alter table public.line_automation_rules
        add constraint line_automation_rules_oa_fkey
        foreign key (organization_id) references public.line_official_accounts (organization_id);
    exception when duplicate_object then null;
    end;
    begin
      alter table public.line_automation_jobs
        add constraint line_automation_jobs_oa_fkey
        foreign key (organization_id) references public.line_official_accounts (organization_id);
    exception when duplicate_object then null;
    end;
    begin
      alter table public.line_customer_bindings
        add constraint line_customer_bindings_oa_fkey
        foreign key (organization_id) references public.line_official_accounts (organization_id);
    exception when duplicate_object then null;
    end;
  end if;
end $$;

alter table public.line_customer_bind_challenges enable row level security;
alter table public.line_customer_bindings enable row level security;
alter table public.line_notification_preferences enable row level security;
alter table public.line_automation_rules enable row level security;
alter table public.line_automation_jobs enable row level security;
alter table public.line_automation_deliveries enable row level security;
alter table public.line_automation_dry_runs enable row level security;

revoke all on public.line_customer_bind_challenges from public, anon, authenticated;
revoke all on public.line_customer_bindings from public, anon, authenticated;
revoke all on public.line_notification_preferences from public, anon, authenticated;
revoke all on public.line_automation_rules from public, anon, authenticated;
revoke all on public.line_automation_jobs from public, anon, authenticated;
revoke all on public.line_automation_deliveries from public, anon, authenticated;
revoke all on public.line_automation_dry_runs from public, anon, authenticated;

grant select on public.line_automation_rules to authenticated;
grant select on public.line_automation_jobs to authenticated;
grant select on public.line_automation_deliveries to authenticated;
grant select on public.line_notification_preferences to authenticated;
grant select on public.line_automation_dry_runs to authenticated;

drop policy if exists line_automation_rules_select_owner on public.line_automation_rules;
create policy line_automation_rules_select_owner
on public.line_automation_rules for select to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_automation_jobs_select_owner on public.line_automation_jobs;
create policy line_automation_jobs_select_owner
on public.line_automation_jobs for select to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_automation_deliveries_select_owner on public.line_automation_deliveries;
create policy line_automation_deliveries_select_owner
on public.line_automation_deliveries for select to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_notification_preferences_select_owner on public.line_notification_preferences;
create policy line_notification_preferences_select_owner
on public.line_notification_preferences for select to authenticated
using (public.user_is_org_owner(organization_id));

drop policy if exists line_automation_dry_runs_select_owner on public.line_automation_dry_runs;
create policy line_automation_dry_runs_select_owner
on public.line_automation_dry_runs for select to authenticated
using (public.user_is_org_owner(organization_id));

-- ---------------------------------------------------------------------------
-- Owner rule upsert + workspace read
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

  -- Safe rule change: cancel scheduled jobs that the new rule must not send.
  -- New timings are created on the next same-org appointment write. No auto-send.
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

revoke all on function public.upsert_line_appointment_reminder_rule(text, boolean, text[], text, text)
  from public, anon;
grant execute on function public.upsert_line_appointment_reminder_rule(text, boolean, text[], text, text)
  to authenticated;

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
  v_bind_count integer := 0;
  v_planned integer := 0;
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  select * into v_rule
  from public.line_automation_rules
  where organization_id = p_organization_id
    and automation_id = 'appointment_reminder';

  select count(*) into v_bind_count
  from public.line_customer_bindings b
  join public.line_notification_preferences p
    on p.organization_id = b.organization_id
   and p.customer_app_id = b.customer_app_id
  where b.organization_id = p_organization_id
    and b.verified = true
    and b.unbound_at is null
    and b.blocked_at is null
    and p.appointment_reminder_opt_in = true
    and p.unsubscribed_at is null;

  select count(*) into v_planned
  from public.line_automation_jobs
  where organization_id = p_organization_id
    and status = 'scheduled';

  return jsonb_build_object(
    'ok', true,
    'organization_id', p_organization_id,
    'enabled', coalesce(v_rule.enabled, false),
    'timing_ids', coalesce(v_rule.timing_ids, '{}'),
    'template', coalesce(v_rule.template, ''),
    'saved', v_rule.organization_id is not null,
    'bind_count', v_bind_count,
    'planned_count', v_planned
  );
end;
$$;

revoke all on function public.read_line_appointment_reminder_workspace(text) from public, anon;
grant execute on function public.read_line_appointment_reminder_workspace(text) to authenticated;

-- ---------------------------------------------------------------------------
-- Job sync from appointment write (same-org authenticated staff)
-- ---------------------------------------------------------------------------
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
  v_member boolean := false;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.staff_auth_memberships m
    where m.organization_id = p_organization_id
      and m.auth_user_id = auth.uid()
      and m.is_active = true
  ) into v_member;
  if not v_member and session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
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

revoke all on function public.sync_line_appointment_reminder_jobs(text, text) from public, anon;
grant execute on function public.sync_line_appointment_reminder_jobs(text, text) to authenticated;

create or replace function public.insert_line_appointment_reminder_jobs(
  p_organization_id text,
  p_jobs jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_item jsonb;
  v_count integer := 0;
  v_member boolean := false;
begin
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  select exists (
    select 1 from public.staff_auth_memberships m
    where m.organization_id = p_organization_id
      and m.auth_user_id = auth.uid()
      and m.is_active = true
  ) into v_member;
  if not v_member
     and not public.user_is_org_owner(p_organization_id)
     and session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if jsonb_typeof(p_jobs) <> 'array' then
    raise exception 'invalid jobs' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_jobs)
  loop
    if coalesce(v_item->>'organizationId', '') <> p_organization_id then
      raise exception 'unauthorized' using errcode = '42501';
    end if;
    insert into public.line_automation_jobs (
      id, organization_id, appointment_app_id, customer_app_id, service_app_id,
      timing_id, fingerprint, scheduled_for, status, request_id
    ) values (
      coalesce(v_item->>'id', 'laj-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16)),
      p_organization_id,
      v_item->>'appointmentId',
      v_item->>'customerId',
      v_item->>'serviceId',
      v_item->>'timingId',
      v_item->>'fingerprint',
      (v_item->>'scheduledFor')::timestamptz,
      'scheduled',
      coalesce(v_item->>'requestId', 'larq-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16))
    )
    on conflict do nothing;
    v_count := v_count + 1;
  end loop;

  return jsonb_build_object('ok', true, 'inserted', v_count);
end;
$$;

revoke all on function public.insert_line_appointment_reminder_jobs(text, jsonb) from public, anon;
grant execute on function public.insert_line_appointment_reminder_jobs(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Stale claimed → pending_confirmation. Never retries. Does not block Channel.
-- ---------------------------------------------------------------------------
create or replace function public.finalize_stale_line_appointment_reminder_claimed(
  p_stale_after_seconds integer default 30
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer := 0;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_automation_jobs
  set status = 'pending_confirmation',
      updated_at = now()
  where status = 'claimed'
    and claimed_at is not null
    and claimed_at < now() - make_interval(secs => greatest(p_stale_after_seconds, 5));
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.finalize_stale_line_appointment_reminder_claimed(integer)
  from public, anon, authenticated;

create or replace function public.reconcile_line_appointment_reminder_job(
  p_organization_id text,
  p_request_id text,
  p_status text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job public.line_automation_jobs%rowtype;
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_status not in ('failed', 'reconciled') then
    raise exception 'invalid status' using errcode = '22023';
  end if;
  select * into v_job
  from public.line_automation_jobs
  where organization_id = p_organization_id
    and request_id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;
  if v_job.status <> 'pending_confirmation' then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  update public.line_automation_jobs
  set status = p_status, skip_reason = 'fingerprint_changed', updated_at = now()
  where id = v_job.id;
  insert into public.line_automation_deliveries (
    id, organization_id, job_id, request_id, status, message
  ) values (
    'lad-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_organization_id, v_job.id, p_request_id, 'reconciled',
    '人工對帳，系統沒有重送'
  );
  return jsonb_build_object('ok', true, 'status', p_status, 'retried', false);
end;
$$;

revoke all on function public.reconcile_line_appointment_reminder_job(text, text, text)
  from public, anon;
grant execute on function public.reconcile_line_appointment_reminder_job(text, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Atomic claim. Shared Channel lock. pending_confirmation does not hold lock.
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
  v_job public.line_automation_jobs%rowtype;
  v_channel_id text;
  v_lock_key bigint;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_request_id is null or p_request_id not like 'larq-%' then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  perform public.finalize_stale_line_appointment_reminder_claimed(30);

  select channel_id into v_channel_id
  from public.line_official_accounts
  where organization_id = p_organization_id;
  if v_channel_id is null then
    return jsonb_build_object('ok', false, 'reason', 'not_configured');
  end if;

  v_lock_key := ('x' || substr(md5('line-channel-lock:' || v_channel_id), 1, 16))::bit(64)::bigint;
  perform pg_advisory_xact_lock(870121, (v_lock_key % 2147483647)::int);

  if exists (
    select 1 from public.line_broadcasts b
    join public.line_official_accounts a on a.organization_id = b.organization_id
    where a.channel_id = v_channel_id
      and b.status = 'sending'
  ) or exists (
    select 1 from public.line_automation_jobs j
    join public.line_official_accounts a on a.organization_id = j.organization_id
    where a.channel_id = v_channel_id
      and j.status = 'claimed'
      and j.claimed_at > now() - interval '30 seconds'
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
  if v_job.status in ('accepted', 'failed', 'canceled', 'expired', 'skipped', 'pending_confirmation', 'reconciled')
     or v_job.send_claimed_at is not null then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status = 'claimed' then
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
  set status = 'claimed', claimed_at = now(), send_claimed_at = now(), updated_at = now()
  where id = v_job.id and status = 'scheduled' and send_claimed_at is null
  returning * into v_job;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  return jsonb_build_object('ok', true, 'request_id', v_job.request_id, 'job_id', v_job.id);
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
  v_job public.line_automation_jobs%rowtype;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    return jsonb_build_object('ok', false, 'reason', 'unauthorized');
  end if;
  if p_status not in ('accepted', 'failed', 'pending_confirmation', 'skipped', 'expired') then
    return jsonb_build_object('ok', false, 'reason', 'invalid_input');
  end if;

  select * into v_job
  from public.line_automation_jobs
  where organization_id = p_organization_id and request_id = p_request_id
  for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;
  if v_job.status in ('accepted', 'pending_confirmation') then
    return jsonb_build_object('ok', false, 'reason', 'duplicate');
  end if;

  update public.line_automation_jobs
  set status = p_status, updated_at = now()
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

create or replace function public.record_line_appointment_reminder_dry_run(
  p_organization_id text,
  p_job_id text,
  p_request_id text,
  p_eligible boolean,
  p_skip_reason text,
  p_message text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_organization_id is null or p_organization_id not like 'org-%' then
    raise exception 'invalid organization' using errcode = '22023';
  end if;
  insert into public.line_automation_dry_runs (
    id, organization_id, job_id, request_id, eligible, skip_reason, message
  ) values (
    'ldr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_organization_id, p_job_id, p_request_id, coalesce(p_eligible, false),
    p_skip_reason, left(coalesce(p_message, 'dry-run'), 200)
  );
  return jsonb_build_object('ok', true, 'sent', false);
end;
$$;

revoke all on function public.record_line_appointment_reminder_dry_run(text, text, text, boolean, text, text)
  from public, anon;
grant execute on function public.record_line_appointment_reminder_dry_run(text, text, text, boolean, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Customer bind / consent / block
-- ---------------------------------------------------------------------------
create or replace function public.start_line_customer_bind_challenge(
  p_organization_id text,
  p_customer_app_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id text;
  v_code text;
  v_hash text;
  v_expires timestamptz := now() + interval '10 minutes';
begin
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_customer_app_id is null or length(btrim(p_customer_app_id)) < 3 then
    raise exception 'invalid customer' using errcode = '22023';
  end if;

  update public.line_customer_bind_challenges
  set consumed_at = now()
  where organization_id = p_organization_id
    and customer_app_id = p_customer_app_id
    and consumed_at is null;

  v_id := 'lcc-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16);
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8));
  v_hash := encode(sha256(convert_to(p_organization_id || ':' || v_code, 'utf8')), 'hex');

  insert into public.line_customer_bind_challenges (
    id, organization_id, customer_app_id, code_hash, expires_at
  ) values (v_id, p_organization_id, p_customer_app_id, v_hash, v_expires);

  return jsonb_build_object(
    'challenge_id', v_id,
    'code', v_code,
    'expires_at', v_expires,
    'consent', 'sending_code_opts_in_appointment_reminder'
  );
end;
$$;

revoke all on function public.start_line_customer_bind_challenge(text, text) from public, anon;
grant execute on function public.start_line_customer_bind_challenge(text, text) to authenticated;

create or replace function public.consume_line_customer_bind_challenge(
  p_organization_id text,
  p_code text,
  p_line_user_id_cipher text,
  p_line_user_id_hash text,
  p_line_user_id_hint text,
  p_key_id text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.line_customer_bind_challenges%rowtype;
  v_hash text;
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_line_user_id_hash is null or length(p_line_user_id_hash) <> 64 then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;
  if p_line_user_id_cipher is null or p_line_user_id_cipher not like 'v1.%' then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  v_hash := encode(sha256(convert_to(p_organization_id || ':' || upper(btrim(p_code)), 'utf8')), 'hex');
  select * into v_row
  from public.line_customer_bind_challenges
  where organization_id = p_organization_id
    and consumed_at is null
    and expires_at > now()
    and code_hash = v_hash
  for update;
  if not found then
    return jsonb_build_object('bound', false, 'reason', 'invalid_input');
  end if;

  if exists (
    select 1 from public.line_customer_bindings
    where organization_id = p_organization_id
      and line_user_id_hash = p_line_user_id_hash
      and unbound_at is null
      and customer_app_id <> v_row.customer_app_id
  ) then
    return jsonb_build_object('bound', false, 'reason', 'duplicate');
  end if;

  update public.line_customer_bind_challenges set consumed_at = now() where id = v_row.id;

  insert into public.line_customer_bindings (
    organization_id, customer_app_id, line_user_id_cipher, line_user_id_hash,
    line_user_id_hint, key_id, verified, bind_method, bound_at, updated_at
  ) values (
    p_organization_id, v_row.customer_app_id, p_line_user_id_cipher, p_line_user_id_hash,
    p_line_user_id_hint, p_key_id, true, 'webhook_code', now(), now()
  )
  on conflict (organization_id, customer_app_id) do update
    set line_user_id_cipher = excluded.line_user_id_cipher,
        line_user_id_hash = excluded.line_user_id_hash,
        line_user_id_hint = excluded.line_user_id_hint,
        key_id = excluded.key_id,
        verified = true,
        bind_method = 'webhook_code',
        bound_at = now(),
        unbound_at = null,
        blocked_at = null,
        updated_at = now();

  insert into public.line_notification_preferences (
    organization_id, customer_app_id, appointment_reminder_opt_in, unsubscribed_at, updated_at
  ) values (
    p_organization_id, v_row.customer_app_id, true, null, now()
  )
  on conflict (organization_id, customer_app_id) do update
    set appointment_reminder_opt_in = true,
        unsubscribed_at = null,
        updated_at = now();

  return jsonb_build_object('bound', true, 'consented', true, 'customer_app_id', v_row.customer_app_id);
end;
$$;

revoke all on function public.consume_line_customer_bind_challenge(text, text, text, text, text, text)
  from public, anon, authenticated;

create or replace function public.mark_line_customer_unsubscribed(
  p_organization_id text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_notification_preferences p
  set appointment_reminder_opt_in = false,
      unsubscribed_at = now(),
      updated_at = now()
  from public.line_customer_bindings b
  where b.organization_id = p_organization_id
    and b.line_user_id_hash = p_line_user_id_hash
    and b.unbound_at is null
    and p.organization_id = b.organization_id
    and p.customer_app_id = b.customer_app_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_line_customer_unsubscribed(text, text)
  from public, anon, authenticated;

create or replace function public.mark_line_customer_blocked(
  p_organization_id text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_customer_bindings
  set blocked_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and line_user_id_hash = p_line_user_id_hash
    and unbound_at is null;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.mark_line_customer_blocked(text, text)
  from public, anon, authenticated;

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
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_customer_bindings
  set unbound_at = now(), verified = false, updated_at = now()
  where organization_id = p_organization_id
    and customer_app_id = p_customer_app_id
    and unbound_at is null;
  update public.line_notification_preferences
  set appointment_reminder_opt_in = false, unsubscribed_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and customer_app_id = p_customer_app_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unbind_line_customer_binding(text, text) from public, anon;
grant execute on function public.unbind_line_customer_binding(text, text) to authenticated;

create or replace function public.unbind_line_customer_by_hash(
  p_organization_id text,
  p_line_user_id_hash text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  update public.line_customer_bindings
  set unbound_at = now(), verified = false, updated_at = now()
  where organization_id = p_organization_id
    and line_user_id_hash = p_line_user_id_hash
    and unbound_at is null;
  update public.line_notification_preferences p
  set appointment_reminder_opt_in = false,
      unsubscribed_at = now(),
      updated_at = now()
  from public.line_customer_bindings b
  where b.organization_id = p_organization_id
    and b.line_user_id_hash = p_line_user_id_hash
    and p.organization_id = b.organization_id
    and p.customer_app_id = b.customer_app_id;
  return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.unbind_line_customer_by_hash(text, text)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Organization association (real FK, not a comment). Jobs/deliveries already
-- share (id, organization_id). This also pins organization_id to org.app_id
-- and the Official Account when those tables exist.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'app_id'
  ) then
    begin
      alter table public.line_automation_jobs
        add constraint line_automation_jobs_org_app_fkey
        foreign key (organization_id) references public.organizations (app_id);
    exception when others then null;
    end;
    begin
      alter table public.line_automation_deliveries
        add constraint line_automation_deliveries_org_app_fkey
        foreign key (organization_id) references public.organizations (app_id);
    exception when others then null;
    end;
    begin
      alter table public.line_customer_bindings
        add constraint line_customer_bindings_org_app_fkey
        foreign key (organization_id) references public.organizations (app_id);
    exception when others then null;
    end;
    begin
      alter table public.line_automation_rules
        add constraint line_automation_rules_org_app_fkey
        foreign key (organization_id) references public.organizations (app_id);
    exception when others then null;
    end;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- Dry-run tick. Reads due jobs, re-checks gates, records, never claims send.
-- ---------------------------------------------------------------------------
create or replace function public.run_line_appointment_reminder_dry_run(
  p_organization_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_job record;
  v_checked integer := 0;
  v_eligible boolean;
  v_reason text;
  v_message text;
  v_rule public.line_automation_rules%rowtype;
  v_bind public.line_customer_bindings%rowtype;
  v_pref public.line_notification_preferences%rowtype;
  v_appt_status text;
  v_appt_starts timestamptz;
  v_appt_customer text;
  v_appt_service text;
  v_fire timestamptz;
  v_inflight boolean;
  v_has_appointments boolean;
begin
  if p_organization_id is null then
    if session_user not in ('postgres', 'service_role', 'supabase_admin') then
      raise exception 'unauthorized' using errcode = '42501';
    end if;
  elsif session_user not in ('postgres', 'service_role', 'supabase_admin')
     and not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;

  if session_user in ('postgres', 'service_role', 'supabase_admin') then
    perform public.finalize_stale_line_appointment_reminder_claimed(30);
  end if;

  select exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'appointments'
  ) into v_has_appointments;

  for v_job in
    select *
    from public.line_automation_jobs
    where status = 'scheduled'
      and scheduled_for <= now()
      and scheduled_for >= now() - interval '20 minutes'
      and (p_organization_id is null or organization_id = p_organization_id)
    order by scheduled_for
  loop
    v_eligible := false;
    v_reason := null;
    v_message := 'Dry-run 檢查未完成';

    select * into v_rule
    from public.line_automation_rules
    where organization_id = v_job.organization_id
      and automation_id = 'appointment_reminder';

    if v_rule.organization_id is null or v_rule.enabled is not true then
      v_reason := 'rule_disabled';
      v_message := '規則未啟用，Dry-run 不會發送';
    elsif not (v_job.timing_id = any (coalesce(v_rule.timing_ids, '{}'::text[]))) then
      v_reason := 'timing_disabled';
      v_message := '此時機已關閉，Dry-run 不會發送';
    else
      v_appt_status := null;
      v_appt_starts := null;
      v_appt_customer := null;
      v_appt_service := null;
      if v_has_appointments then
        begin
          execute $q$
            select a.status::text, a.starts_at, c.app_id, s.app_id
            from public.appointments a
            join public.organizations o on o.id = a.organization_id
            join public.customers c on c.id = a.customer_id
            join public.services s on s.id = a.service_id
            where o.app_id = $1 and a.app_id = $2
          $q$ into v_appt_status, v_appt_starts, v_appt_customer, v_appt_service
          using v_job.organization_id, v_job.appointment_app_id;
        exception when undefined_table or undefined_column then
          v_appt_status := null;
        end;
      end if;

      if v_appt_status is null then
        v_reason := 'appointment_inactive';
        v_message := '找不到可驗證的預約，Dry-run 不會發送';
      elsif v_appt_status in ('CANCELLED', 'NO_SHOW') then
        v_reason := 'appointment_cancelled';
        v_message := '預約已取消，不會發送';
      elsif v_appt_status = 'COMPLETED' then
        v_reason := 'appointment_completed';
        v_message := '預約已完成，不會發送';
      elsif v_appt_status not in ('BOOKED', 'CONFIRMED') then
        v_reason := 'appointment_inactive';
        v_message := '預約狀態已變更，不會發送';
      elsif v_appt_customer is distinct from v_job.customer_app_id
         or v_appt_service is distinct from v_job.service_app_id then
        v_reason := 'fingerprint_changed';
        v_message := '預約內容已變更，舊提醒不會發送';
      else
        if v_job.timing_id = 'hours_before_3' then
          v_fire := v_appt_starts - interval '3 hours';
        else
          v_fire := (
            ((v_appt_starts at time zone 'Asia/Taipei')::date - 1) + time '10:00'
          ) at time zone 'Asia/Taipei';
        end if;
        if v_fire is distinct from v_job.scheduled_for then
          v_reason := 'fingerprint_changed';
          v_message := '預約時間已變更，舊提醒不會發送';
        else
          select * into v_bind
          from public.line_customer_bindings
          where organization_id = v_job.organization_id
            and customer_app_id = v_job.customer_app_id;
          select * into v_pref
          from public.line_notification_preferences
          where organization_id = v_job.organization_id
            and customer_app_id = v_job.customer_app_id;

          if v_bind.organization_id is null or v_bind.verified is not true
             or v_bind.unbound_at is not null then
            v_reason := 'unbound';
            v_message := '客人尚未完成已驗證的 LINE 綁定，系統不會發送';
          elsif v_bind.blocked_at is not null then
            v_reason := 'blocked';
            v_message := '客人已封鎖官方帳號，系統不會發送';
          elsif v_pref.organization_id is null or v_pref.appointment_reminder_opt_in is not true then
            v_reason := 'not_consented';
            v_message := '客人尚未同意預約提醒通知';
          elsif v_pref.unsubscribed_at is not null then
            v_reason := 'unsubscribed';
            v_message := '客人已退訂預約提醒，系統不會發送';
          else
            select exists (
              select 1 from public.line_broadcasts b
              join public.line_official_accounts a on a.organization_id = b.organization_id
              join public.line_official_accounts mine on mine.organization_id = v_job.organization_id
              where a.channel_id = mine.channel_id
                and b.status = 'sending'
            ) or exists (
              select 1 from public.line_automation_jobs j
              join public.line_official_accounts a on a.organization_id = j.organization_id
              join public.line_official_accounts mine on mine.organization_id = v_job.organization_id
              where a.channel_id = mine.channel_id
                and j.status = 'claimed'
                and j.claimed_at > now() - interval '30 seconds'
            ) into v_inflight;
            if v_inflight then
              v_reason := 'inflight';
              v_message := '同一 LINE Channel 尚有發送進行中，已停止以免超額';
            else
              -- Quota is unknown without calling LINE. Fail-closed. Never Push.
              v_reason := 'quota_unknown';
              v_message := 'Dry-run 未查詢 LINE 額度，正式發送關閉，沒有連接 LINE Push';
            end if;
          end if;
        end if;
      end if;
    end if;

    insert into public.line_automation_dry_runs (
      id, organization_id, job_id, request_id, eligible, skip_reason, message
    ) values (
      'ldr-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
      v_job.organization_id, v_job.id, v_job.request_id, v_eligible,
      v_reason, left(v_message, 200)
    );
    v_checked := v_checked + 1;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'checked', v_checked,
    'sent', false,
    'eligible', false
  );
end;
$$;

revoke all on function public.run_line_appointment_reminder_dry_run(text) from public, anon;
grant execute on function public.run_line_appointment_reminder_dry_run(text) to authenticated;

create or replace function public.list_due_line_appointment_reminder_jobs(
  p_organization_id text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if session_user not in ('postgres', 'service_role', 'supabase_admin') then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', id,
      'organizationId', organization_id,
      'appointmentId', appointment_app_id,
      'customerId', customer_app_id,
      'serviceId', service_app_id,
      'timingId', timing_id,
      'fingerprint', fingerprint,
      'scheduledFor', scheduled_for,
      'status', status,
      'requestId', request_id,
      'claimedAt', claimed_at,
      'sendClaimedAt', send_claimed_at
    ) order by scheduled_for)
    from public.line_automation_jobs
    where status = 'scheduled'
      and scheduled_for <= now()
      and scheduled_for >= now() - interval '20 minutes'
      and (p_organization_id is null or organization_id = p_organization_id)
  ), '[]'::jsonb);
end;
$$;

revoke all on function public.list_due_line_appointment_reminder_jobs(text)
  from public, anon, authenticated;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.finalize_stale_line_appointment_reminder_claimed(integer) to service_role';
    execute 'grant execute on function public.claim_line_appointment_reminder_job(text, text, boolean, integer, timestamptz) to service_role';
    execute 'grant execute on function public.complete_line_appointment_reminder_job(text, text, text, text, integer, text, text) to service_role';
    execute 'grant execute on function public.consume_line_customer_bind_challenge(text, text, text, text, text, text) to service_role';
    execute 'grant execute on function public.mark_line_customer_unsubscribed(text, text) to service_role';
    execute 'grant execute on function public.mark_line_customer_blocked(text, text) to service_role';
    execute 'grant execute on function public.unbind_line_customer_by_hash(text, text) to service_role';
    execute 'grant execute on function public.list_due_line_appointment_reminder_jobs(text) to service_role';
    execute 'grant execute on function public.run_line_appointment_reminder_dry_run(text) to service_role';
    execute 'grant execute on function public.sync_line_appointment_reminder_jobs(text, text) to service_role';
    execute 'grant execute on function public.insert_line_appointment_reminder_jobs(text, jsonb) to service_role';
  end if;
end $$;
