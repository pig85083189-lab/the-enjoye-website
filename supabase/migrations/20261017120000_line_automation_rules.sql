-- LINE automation rule persistence. Additive. Default closed.
-- Compatible with Preview Phase 2B table shape (automation_id / timing_ids / template).
-- Source of the existing Preview table: Phase 2B
--   supabase/migrations/20261013120000_line_appointment_reminder_automation.sql
--   (applied off this branch; commit 9144e66). Not present in this migration chain.
-- Existing Preview columns stay. Phase 1 columns are added and backfilled only when null.
-- Does not DROP TABLE, DROP COLUMN, TRUNCATE, or DELETE existing rows.
-- Does not CREATE OR REPLACE / DROP Phase 2B functions. Their live signatures are:
--   upsert_line_appointment_reminder_rule(text, boolean, text[], text, text)
--   read_line_appointment_reminder_workspace(text)
--   sync_line_appointment_reminder_jobs(text, text)
-- Phase 1 functions use different names, so they do not collide:
--   upsert_line_automation_rule(text, text, boolean, jsonb, text)
--   set_line_automation_enabled(text, text, boolean)
--   line_automation_timing_config_valid(text, jsonb)
-- Widens line_automation_rules_id_check / timing_check so five automation types can
-- coexist. appointment_reminder timing_ids stay inside the Phase 2B catalog so the
-- old reminder RPC and jobs table keep working. Dual-write + trigger keep both
-- column sets aligned. Does not open send. Does not alter Broadcast / Webhook /
-- secrets tables. Do not apply on Production until Owner confirms.

create table if not exists public.line_automation_rules (
  organization_id text not null,
  automation_id text not null,
  enabled boolean not null default false,
  timing_ids text[] not null default '{}',
  template text not null default '',
  updated_by_staff_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, automation_id)
);

comment on table public.line_automation_rules is
  'Per-organization LINE automation settings. enabled means the owner wants the rule later; it does not send LINE. Phase 1 columns coexist with Phase 2B legacy columns.';

do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'id'
  ) then
    alter table public.line_automation_rules add column id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'automation_type'
  ) then
    alter table public.line_automation_rules add column automation_type text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'timing_config'
  ) then
    alter table public.line_automation_rules add column timing_config jsonb;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'message_template'
  ) then
    alter table public.line_automation_rules add column message_template text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'updated_by'
  ) then
    alter table public.line_automation_rules add column updated_by text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'automation_id'
  ) then
    alter table public.line_automation_rules add column automation_id text;
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'timing_ids'
  ) then
    alter table public.line_automation_rules add column timing_ids text[] default '{}';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'template'
  ) then
    alter table public.line_automation_rules add column template text default '';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_automation_rules' and column_name = 'updated_by_staff_id'
  ) then
    alter table public.line_automation_rules add column updated_by_staff_id text;
  end if;
end $$;

-- Preserve existing values. Only fill Phase 1 columns when they are still null.
update public.line_automation_rules
set automation_type = automation_id
where automation_type is null
  and automation_id is not null;

update public.line_automation_rules
set automation_id = automation_type
where automation_id is null
  and automation_type is not null;

update public.line_automation_rules
set message_template = coalesce(template, '')
where message_template is null;

update public.line_automation_rules
set template = coalesce(message_template, '')
where template is null;

update public.line_automation_rules
set timing_config = jsonb_build_object(
  'selectedTimingIds', to_jsonb(coalesce(timing_ids, '{}'::text[])),
  'customTimings', '[]'::jsonb
)
where timing_config is null
   or (
     coalesce(cardinality(timing_ids), 0) > 0
     and (
       jsonb_typeof(timing_config->'selectedTimingIds') is distinct from 'array'
       or jsonb_array_length(coalesce(timing_config->'selectedTimingIds', '[]'::jsonb)) = 0
     )
   );

update public.line_automation_rules
set timing_config = '{"selectedTimingIds":[],"customTimings":[]}'::jsonb
where timing_config is null;

update public.line_automation_rules
set timing_ids = coalesce(timing_ids, '{}'::text[])
where timing_ids is null;

update public.line_automation_rules
set updated_by = updated_by_staff_id
where updated_by is null
  and updated_by_staff_id is not null;

update public.line_automation_rules
set updated_by_staff_id = updated_by
where updated_by_staff_id is null
  and updated_by is not null;

update public.line_automation_rules
set id = 'lar-' || substr(md5(organization_id || ':' || coalesce(automation_type, automation_id, '')), 1, 16)
where id is null
  and organization_id is not null
  and coalesce(automation_type, automation_id) is not null;

do $$
begin
  if not exists (
    select 1 from public.line_automation_rules
    where automation_type is null or id is null or timing_config is null or message_template is null
  ) then
    begin
      alter table public.line_automation_rules
        alter column automation_type set not null;
    exception when others then null;
    end;
    begin
      alter table public.line_automation_rules
        alter column id set not null;
    exception when others then null;
    end;
    begin
      alter table public.line_automation_rules
        alter column timing_config set not null;
    exception when others then null;
    end;
    begin
      alter table public.line_automation_rules
        alter column message_template set not null;
    exception when others then null;
    end;
  end if;
end $$;

alter table public.line_automation_rules drop constraint if exists line_automation_rules_id_check;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_type_check;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_timing_check;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_id_prefix;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_org_prefix;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_template_not_blank;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_timing_object;
alter table public.line_automation_rules drop constraint if exists line_automation_rules_updater_operational;

alter table public.line_automation_rules
  add constraint line_automation_rules_org_prefix
    check (organization_id like 'org-%');

alter table public.line_automation_rules
  add constraint line_automation_rules_id_prefix
    check (id is null or id like 'lar-%');

alter table public.line_automation_rules
  add constraint line_automation_rules_id_check
    check (
      automation_id is null
      or automation_id in (
        'appointment_reminder',
        'birthday_greeting',
        'holiday_greeting',
        'satisfaction_survey',
        'coupon_expiry'
      )
    );

alter table public.line_automation_rules
  add constraint line_automation_rules_type_check
    check (
      automation_type is null
      or automation_type in (
        'appointment_reminder',
        'birthday_greeting',
        'holiday_greeting',
        'satisfaction_survey',
        'coupon_expiry'
      )
    );

alter table public.line_automation_rules
  add constraint line_automation_rules_template_not_blank
    check (
      message_template is null
      or length(message_template) <= 5000
    );

alter table public.line_automation_rules
  add constraint line_automation_rules_timing_object
    check (
      timing_config is null
      or jsonb_typeof(timing_config) = 'object'
    );

-- Keep Phase 2B job/RPC compatibility: appointment_reminder timing_ids may only
-- contain the two catalog values the old jobs table accepts. Other types are free.
alter table public.line_automation_rules
  add constraint line_automation_rules_timing_check
    check (
      coalesce(automation_id, automation_type) is distinct from 'appointment_reminder'
      or timing_ids is null
      or timing_ids <@ array['day_before_morning', 'hours_before_3']::text[]
    );

alter table public.line_automation_rules
  add constraint line_automation_rules_updater_operational
    check (
      (updated_by is null or public.is_operational_staff_id(updated_by))
      and (
        updated_by_staff_id is null
        or public.is_operational_staff_id(updated_by_staff_id)
      )
    );

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'line_automation_rules_org_type_unique'
  ) then
    begin
      alter table public.line_automation_rules
        add constraint line_automation_rules_org_type_unique
        unique (organization_id, automation_type);
    exception when others then null;
    end;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conname = 'line_automation_rules_id_unique'
  ) then
    begin
      alter table public.line_automation_rules
        add constraint line_automation_rules_id_unique
        unique (id);
    exception when others then null;
    end;
  end if;
end $$;

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

create or replace function public.line_automation_rules_sync_legacy_columns()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.automation_type is null or btrim(new.automation_type) = '' then
    new.automation_type := new.automation_id;
  end if;
  if new.automation_id is null or btrim(new.automation_id) = '' then
    new.automation_id := new.automation_type;
  end if;
  if new.id is null or btrim(new.id) = '' then
    new.id := 'lar-' || substr(
      md5(coalesce(new.organization_id, '') || ':' || coalesce(new.automation_type, new.automation_id, '')),
      1,
      16
    );
  end if;

  if tg_op = 'UPDATE' then
    if new.message_template is distinct from old.message_template then
      new.template := coalesce(new.message_template, '');
    elsif new.template is distinct from old.template then
      new.message_template := coalesce(new.template, '');
    end if;
    if new.timing_config is distinct from old.timing_config then
      new.timing_ids := coalesce(
        array(
          select jsonb_array_elements_text(coalesce(new.timing_config->'selectedTimingIds', '[]'::jsonb))
        ),
        '{}'::text[]
      );
    elsif new.timing_ids is distinct from old.timing_ids then
      new.timing_config := jsonb_build_object(
        'selectedTimingIds', to_jsonb(coalesce(new.timing_ids, '{}'::text[])),
        'customTimings', coalesce(new.timing_config->'customTimings', '[]'::jsonb)
      );
    end if;
    if new.updated_by is distinct from old.updated_by then
      new.updated_by_staff_id := coalesce(new.updated_by, new.updated_by_staff_id);
    elsif new.updated_by_staff_id is distinct from old.updated_by_staff_id then
      new.updated_by := coalesce(new.updated_by_staff_id, new.updated_by);
    end if;
  else
    if new.message_template is null then
      new.message_template := coalesce(new.template, '');
    end if;
    if new.template is null then
      new.template := coalesce(new.message_template, '');
    end if;
    if new.timing_config is null then
      new.timing_config := jsonb_build_object(
        'selectedTimingIds', to_jsonb(coalesce(new.timing_ids, '{}'::text[])),
        'customTimings', '[]'::jsonb
      );
    end if;
    if new.timing_ids is null then
      new.timing_ids := coalesce(
        array(
          select jsonb_array_elements_text(coalesce(new.timing_config->'selectedTimingIds', '[]'::jsonb))
        ),
        '{}'::text[]
      );
    end if;
    new.updated_by := coalesce(new.updated_by, new.updated_by_staff_id);
    new.updated_by_staff_id := coalesce(new.updated_by_staff_id, new.updated_by);
  end if;

  if new.timing_config is null then
    new.timing_config := '{"selectedTimingIds":[],"customTimings":[]}'::jsonb;
  end if;
  if new.timing_ids is null then
    new.timing_ids := '{}'::text[];
  end if;
  if new.message_template is null then
    new.message_template := '';
  end if;
  if new.template is null then
    new.template := '';
  end if;

  if coalesce(new.automation_type, new.automation_id) = 'appointment_reminder' then
    new.timing_ids := coalesce((
      select array_agg(t)
      from unnest(coalesce(new.timing_ids, '{}'::text[])) as t
      where t in ('day_before_morning', 'hours_before_3')
    ), '{}'::text[]);
  end if;

  return new;
end;
$$;

drop trigger if exists line_automation_rules_sync_legacy_columns
  on public.line_automation_rules;
create trigger line_automation_rules_sync_legacy_columns
before insert or update on public.line_automation_rules
for each row
execute procedure public.line_automation_rules_sync_legacy_columns();

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
  v_timing_ids text[] := '{}';
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
  v_timing_ids := coalesce(
    array(
      select jsonb_array_elements_text(coalesce(p_timing_config->'selectedTimingIds', '[]'::jsonb))
    ),
    '{}'::text[]
  );

  insert into public.line_automation_rules (
    id,
    organization_id,
    automation_type,
    automation_id,
    enabled,
    timing_config,
    timing_ids,
    message_template,
    template,
    updated_by,
    updated_by_staff_id
  ) values (
    'lar-' || substr(md5(p_organization_id || ':' || p_automation_type), 1, 16),
    p_organization_id,
    p_automation_type,
    p_automation_type,
    v_enabled,
    p_timing_config,
    v_timing_ids,
    p_message_template,
    p_message_template,
    v_staff_id,
    v_staff_id
  )
  on conflict (organization_id, automation_type)
  do update set
    enabled = excluded.enabled,
    timing_config = excluded.timing_config,
    timing_ids = excluded.timing_ids,
    message_template = excluded.message_template,
    template = excluded.template,
    updated_at = now(),
    updated_by = excluded.updated_by,
    updated_by_staff_id = excluded.updated_by_staff_id
  returning * into v_row;

  if to_regclass('public.line_automation_jobs') is not null
    and p_automation_type = 'appointment_reminder' then
    update public.line_automation_jobs
    set
      status = 'canceled',
      skip_reason = case
        when v_enabled is not true then 'rule_disabled'
        else 'timing_disabled'
      end,
      updated_at = now()
    where organization_id = p_organization_id
      and status = 'scheduled'
      and (
        v_enabled is not true
        or not (timing_id = any (coalesce(v_timing_ids, '{}'::text[])))
      );
  end if;

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
  'Owner-only upsert of one automation rule per organization and type. Dual-writes Phase 2B columns. Does not send LINE.';

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
    and (
      automation_type = p_automation_type
      or automation_id = p_automation_type
    )
  for update;

  if not found then
    raise exception 'missing rule' using errcode = 'P0002';
  end if;

  update public.line_automation_rules
  set
    enabled = coalesce(p_enabled, false),
    updated_at = now(),
    updated_by = v_staff_id,
    updated_by_staff_id = v_staff_id
  where organization_id = v_row.organization_id
    and automation_id = v_row.automation_id
  returning * into v_row;

  if to_regclass('public.line_automation_jobs') is not null
    and p_automation_type = 'appointment_reminder'
    and coalesce(p_enabled, false) is not true then
    update public.line_automation_jobs
    set
      status = 'canceled',
      skip_reason = 'rule_disabled',
      updated_at = now()
    where organization_id = p_organization_id
      and status = 'scheduled';
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'organization_id', v_row.organization_id,
    'automation_type', coalesce(v_row.automation_type, v_row.automation_id),
    'enabled', v_row.enabled,
    'timing_config', v_row.timing_config,
    'message_template', coalesce(v_row.message_template, v_row.template)
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
