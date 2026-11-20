-- Review only. Not a migration. Run once on the finance project after the
-- 2026-11-19 physical backup. It replaces two constraints and does not
-- update, delete, or rebuild any table or row.
--
-- member_treatment_publications.treatment_id currently references
-- public.treatments. Booking treatments are copied to
-- member_treatment_mirrors, not into finance treatments. The foreign key
-- moves to that mirror primary key.
-- approved_fields_allowlist currently rejects service_name and photos.
-- Those keys are added. status and completed_at stay off the snapshot
-- because the mirror already stores them.

do $$
declare
  foreign_key text;
  allowed text[] := array[
    'consultation_answers', 'professional_note', 'body_marker_details', 'concerns', 'client_focus',
    'comparison_to_last', 'sensitivity_level', 'body_markers', 'body_map_note', 'discomfort_note',
    'client_feeling', 'products', 'follow_up_note', 'follow_up_tags', 'suggest_next_booking',
    'suggested_date', 'suggested_tracking_areas', 'staff_name', 'service_name', 'photos'
  ];
begin
  if to_regclass('public.member_treatment_publications') is null
     or to_regclass('public.member_treatment_mirrors') is null then
    raise exception 'publication repair stopped because a required table is missing';
  end if;

  if exists (
    select 1
    from public.member_treatment_publications publication
    where exists (
      select 1
      from jsonb_object_keys(publication.approved_fields) as key
      where key <> all (allowed)
    )
  ) then
    raise exception 'an existing publication uses a key outside the allowlist; constraint was not replaced';
  end if;

  if not exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_rel on table_rel.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = table_rel.relnamespace
    where namespace.nspname = 'public'
      and table_rel.relname = 'member_treatment_mirrors'
      and constraint_row.contype in ('p', 'u')
      and array_length(constraint_row.conkey, 1) = 1
      and (
        select attribute.attname
        from pg_attribute attribute
        where attribute.attrelid = table_rel.oid
          and attribute.attnum = constraint_row.conkey[1]
      ) = 'treatment_id'
  ) then
    raise exception 'member_treatment_mirrors.treatment_id is not unique; foreign key was not changed';
  end if;

  select pg_get_constraintdef(constraint_row.oid) into foreign_key
  from pg_constraint constraint_row
  join pg_class table_rel on table_rel.oid = constraint_row.conrelid
  join pg_namespace namespace on namespace.oid = table_rel.relnamespace
  where namespace.nspname = 'public'
    and table_rel.relname = 'member_treatment_publications'
    and constraint_row.conname = 'member_treatment_publications_treatment_id_fkey';

  if foreign_key is null then
    raise exception 'publication treatment foreign key is missing; nothing was changed';
  end if;

  if foreign_key ilike '%references public.treatments(%'
     or foreign_key ilike '%references treatments(%' then
    alter table public.member_treatment_publications
      drop constraint member_treatment_publications_treatment_id_fkey;
    alter table public.member_treatment_publications
      add constraint member_treatment_publications_treatment_id_fkey
      foreign key (treatment_id)
      references public.member_treatment_mirrors (treatment_id);
  elsif foreign_key not ilike '%references public.member_treatment_mirrors(%'
        and foreign_key not ilike '%references member_treatment_mirrors(%' then
    raise exception 'unexpected publication foreign key; constraint was not changed';
  end if;

  if exists (
    select 1
    from pg_constraint constraint_row
    join pg_class table_rel on table_rel.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = table_rel.relnamespace
    where namespace.nspname = 'public'
      and table_rel.relname = 'member_treatment_publications'
      and constraint_row.conname = 'approved_fields_allowlist'
  ) then
    alter table public.member_treatment_publications
      drop constraint approved_fields_allowlist;
  end if;

  execute format(
    'alter table public.member_treatment_publications
       add constraint approved_fields_allowlist
       check (
         jsonb_typeof(approved_fields) = ''object''
         and (approved_fields - %L::text[]) = ''{}''::jsonb
       )',
    allowed
  );
end $$;
