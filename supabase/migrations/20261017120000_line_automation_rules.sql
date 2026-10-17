-- LINE automation rule persistence. Additive. Default closed.
-- Does not open send. Does not alter Broadcast / Webhook / secrets tables.
-- Do not apply on Production until Owner confirms.

create table if not exists public.line_automation_rules (
  id text primary key,
  organization_id text not null,
  automation_type text not null,
  enabled boolean not null default false,
  timing_config jsonb not null default '{"selectedTimingIds":[],"customTimings":[]}'::jsonb,
  message_template text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by text,
  constraint line_automation_rules_id_prefix
    check (id like 'lar-%'),
  constraint line_automation_rules_org_prefix
    check (organization_id like 'org-%'),
  constraint line_automation_rules_type_check
    check (
      automation_type in (
        'appointment_reminder',
        'birthday_greeting',
        'holiday_greeting',
        'satisfaction_survey',
        'coupon_expiry'
      )
    ),
  constraint line_automation_rules_template_not_blank
    check (
      length(btrim(message_template)) > 0
      and length(message_template) <= 5000
    ),
  constraint line_automation_rules_timing_object
    check (jsonb_typeof(timing_config) = 'object'),
  constraint line_automation_rules_updater_operational
    check (
      updated_by is null
      or public.is_operational_staff_id(updated_by)
    ),
  constraint line_automation_rules_org_type_unique
    unique (organization_id, automation_type)
);

comment on table public.line_automation_rules is
  'Per-organization LINE automation settings. enabled means the owner wants the rule later; it does not send LINE.';

create index if not exists line_automation_rules_org_updated_idx
  on public.line_automation_rules (organization_id, updated_at desc);

alter table public.line_automation_rules enable row level security;

revoke all on public.line_automation_rules from anon, authenticated, public;
grant select on public.line_automation_rules to authenticated;

drop policy if exists line_automation_rules_select_owner
  on public.line_automation_rules;
create policy line_automation_rules_select_owner
on public.line_automation_rules
for select
to authenticated
using (public.user_is_org_owner(organization_id));

create or replace function public.upsert_line_automation_rule(
  p_organization_id text,
  p_automation_type text,
  p_enabled boolean,
  p_timing_config jsonb,
  p_message_template text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff_id text;
  v_id text;
  v_enabled boolean := coalesce(p_enabled, false);
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_automation_type not in (
    'appointment_reminder',
    'birthday_greeting',
    'holiday_greeting',
    'satisfaction_survey',
    'coupon_expiry'
  ) then
    raise exception 'invalid automation' using errcode = '22023';
  end if;
  if p_message_template is null
    or length(btrim(p_message_template)) = 0
    or length(p_message_template) > 5000 then
    raise exception 'invalid template' using errcode = '22023';
  end if;
  if p_timing_config is null
    or jsonb_typeof(p_timing_config) <> 'object'
    or jsonb_typeof(p_timing_config->'selectedTimingIds') is distinct from 'array'
    or jsonb_array_length(p_timing_config->'selectedTimingIds') < 1 then
    raise exception 'invalid timing' using errcode = '22023';
  end if;

  v_staff_id := public.user_operational_staff_id(
    (select o.id from public.organizations o where o.app_id = p_organization_id)
  );

  insert into public.line_automation_rules (
    id,
    organization_id,
    automation_type,
    enabled,
    timing_config,
    message_template,
    updated_by
  ) values (
    'lar-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 16),
    p_organization_id,
    p_automation_type,
    v_enabled,
    p_timing_config,
    p_message_template,
    v_staff_id
  )
  on conflict (organization_id, automation_type)
  do update set
    enabled = excluded.enabled,
    timing_config = excluded.timing_config,
    message_template = excluded.message_template,
    updated_at = now(),
    updated_by = excluded.updated_by
  returning id into v_id;

  return jsonb_build_object(
    'id', v_id,
    'organization_id', p_organization_id,
    'automation_type', p_automation_type,
    'enabled', v_enabled
  );
end;
$$;

comment on function public.upsert_line_automation_rule(text, text, boolean, jsonb, text) is
  'Owner-only upsert of one automation rule per organization and type. Does not send LINE.';

create or replace function public.set_line_automation_enabled(
  p_organization_id text,
  p_automation_type text,
  p_enabled boolean
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_staff_id text;
  v_row public.line_automation_rules%rowtype;
begin
  if v_uid is null then
    raise exception 'not authenticated' using errcode = '42501';
  end if;
  if not public.user_is_org_owner(p_organization_id) then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
  if p_automation_type not in (
    'appointment_reminder',
    'birthday_greeting',
    'holiday_greeting',
    'satisfaction_survey',
    'coupon_expiry'
  ) then
    raise exception 'invalid automation' using errcode = '22023';
  end if;

  v_staff_id := public.user_operational_staff_id(
    (select o.id from public.organizations o where o.app_id = p_organization_id)
  );

  select * into v_row
  from public.line_automation_rules
  where organization_id = p_organization_id
    and automation_type = p_automation_type
  for update;

  if not found then
    raise exception 'missing rule' using errcode = 'P0002';
  end if;

  update public.line_automation_rules
  set
    enabled = coalesce(p_enabled, false),
    updated_at = now(),
    updated_by = v_staff_id
  where id = v_row.id
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'organization_id', v_row.organization_id,
    'automation_type', v_row.automation_type,
    'enabled', v_row.enabled
  );
end;
$$;

comment on function public.set_line_automation_enabled(text, text, boolean) is
  'Owner-only enable flag for a stored automation rule. Does not send LINE.';

revoke all on function public.upsert_line_automation_rule(text, text, boolean, jsonb, text)
  from public, anon;
grant execute on function public.upsert_line_automation_rule(text, text, boolean, jsonb, text)
  to authenticated;

revoke all on function public.set_line_automation_enabled(text, text, boolean)
  from public, anon;
grant execute on function public.set_line_automation_enabled(text, text, boolean)
  to authenticated;
