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

create or replace function public.line_automation_timing_config_valid(
  p_automation_type text,
  p_timing_config jsonb
)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  v_selected jsonb;
  v_custom jsonb;
  v_allowed text[];
  v_selected_ids text[] := '{}';
  v_custom_ids text[] := '{}';
  v_custom_labels text[] := '{}';
  v_item jsonb;
  v_id text;
  v_label text;
  i int;
begin
  if p_timing_config is null or jsonb_typeof(p_timing_config) <> 'object' then
    return false;
  end if;

  v_selected := p_timing_config->'selectedTimingIds';
  v_custom := p_timing_config->'customTimings';
  if jsonb_typeof(v_selected) is distinct from 'array' then
    return false;
  end if;
  if v_custom is null then
    v_custom := '[]'::jsonb;
  elsif jsonb_typeof(v_custom) is distinct from 'array' then
    return false;
  end if;
  if jsonb_array_length(v_selected) < 1 then
    return false;
  end if;
  if jsonb_array_length(v_custom) > 3 then
    return false;
  end if;

  v_allowed := case p_automation_type
    when 'appointment_reminder' then array['day_before_morning', 'hours_before_3']
    when 'birthday_greeting' then array['birthday_morning', 'days_before_3']
    when 'holiday_greeting' then array['cny', 'mid_autumn', 'christmas']
    when 'satisfaction_survey' then array['hours_after_2', 'days_after_1']
    when 'coupon_expiry' then array['days_before_7', 'days_before_3', 'days_before_1']
    else null
  end;
  if v_allowed is null then
    return false;
  end if;

  if jsonb_array_length(v_custom) > 0 then
    for i in 0 .. jsonb_array_length(v_custom) - 1 loop
      v_item := v_custom->i;
      if jsonb_typeof(v_item) <> 'object' then
        return false;
      end if;
      if jsonb_typeof(v_item->'id') is distinct from 'string'
        or jsonb_typeof(v_item->'label') is distinct from 'string' then
        return false;
      end if;
      if coalesce(v_item->>'builtin', 'false') not in ('false', '0') then
        return false;
      end if;
      v_id := btrim(v_item->>'id');
      v_label := btrim(v_item->>'label');
      if v_id = '' or v_label = '' then
        return false;
      end if;
      if v_id = any(v_allowed) or v_id = any(v_custom_ids) or v_label = any(v_custom_labels) then
        return false;
      end if;
      v_custom_ids := array_append(v_custom_ids, v_id);
      v_custom_labels := array_append(v_custom_labels, v_label);
    end loop;
  end if;

  for i in 0 .. jsonb_array_length(v_selected) - 1 loop
    if jsonb_typeof(v_selected->i) is distinct from 'string' then
      return false;
    end if;
    v_id := btrim(v_selected->>i);
    if v_id = '' or v_id = any(v_selected_ids) then
      return false;
    end if;
    if not (v_id = any(v_allowed) or v_id = any(v_custom_ids)) then
      return false;
    end if;
    v_selected_ids := array_append(v_selected_ids, v_id);
  end loop;

  return true;
end;
$$;

comment on function public.line_automation_timing_config_valid(text, jsonb) is
  'Validates automation timing_config against the catalog and custom-timing limits. Does not send LINE.';

revoke all on function public.line_automation_timing_config_valid(text, jsonb)
  from public, anon;
grant execute on function public.line_automation_timing_config_valid(text, jsonb)
  to authenticated;

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
  v_row public.line_automation_rules%rowtype;
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
  if not public.line_automation_timing_config_valid(p_automation_type, p_timing_config) then
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
  returning * into v_row;

  return jsonb_build_object(
    'id', v_row.id,
    'organization_id', v_row.organization_id,
    'automation_type', v_row.automation_type,
    'enabled', v_row.enabled,
    'timing_config', v_row.timing_config,
    'message_template', v_row.message_template
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
    'enabled', v_row.enabled,
    'timing_config', v_row.timing_config,
    'message_template', v_row.message_template
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
