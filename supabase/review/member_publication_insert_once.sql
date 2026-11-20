-- Review only. This file is not in supabase/migrations and is not applied
-- to production by this pull request.
--
-- Live finance schema, read by member_sync_preflight.readonly.sql:
-- member_treatment_publications_pkey is already UNIQUE (treatment_id).
-- approved_by is text. This script does not rebuild the primary key and
-- does not alter that column.
-- A second unique index with another name is not created.
-- The text argument is accepted only when it is an authenticated user UUID.
-- Operational ids such as staff-* are rejected and nothing is inserted.

do $$
declare
  duplicate_ids bigint;
  approver_type text;
  exact_unique bigint;
  incompatible_named bigint;
begin
  if to_regclass('public.member_treatment_publications') is null then
    raise exception 'member_treatment_publications is missing; function was not created';
  end if;

  select count(*) into duplicate_ids
  from (
    select treatment_id
    from public.member_treatment_publications
    group by treatment_id
    having count(*) > 1
  ) duplicates;
  if duplicate_ids > 0 then
    raise exception 'member_treatment_publications already has duplicate treatment_id values; function was not created';
  end if;

  select data_type into approver_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'member_treatment_publications'
    and column_name = 'approved_by';
  if approver_type is distinct from 'text' then
    raise exception 'approved_by must stay text; refusing to change the live column, found %', coalesce(approver_type, 'missing');
  end if;

  select count(*) into exact_unique
  from pg_index indexed
  join pg_class index_rel on index_rel.oid = indexed.indexrelid
  join pg_class table_rel on table_rel.oid = indexed.indrelid
  join pg_namespace namespace on namespace.oid = table_rel.relnamespace
  where namespace.nspname = 'public'
    and table_rel.relname = 'member_treatment_publications'
    and indexed.indisunique
    and indexed.indpred is null
    and indexed.indnkeyatts = 1
    and (
      select attribute.attname
      from pg_attribute attribute
      where attribute.attrelid = table_rel.oid
        and attribute.attnum = indexed.indkey[0]
    ) = 'treatment_id';
  if exact_unique <> 1 then
    raise exception 'expected the existing unique (treatment_id) primary key; found % and created no index', exact_unique;
  end if;

  select count(*) into incompatible_named
  from pg_index indexed
  join pg_class index_rel on index_rel.oid = indexed.indexrelid
  join pg_class table_rel on table_rel.oid = indexed.indrelid
  join pg_namespace namespace on namespace.oid = table_rel.relnamespace
  where namespace.nspname = 'public'
    and table_rel.relname = 'member_treatment_publications'
    and index_rel.relname = 'member_treatment_publications_treatment_id_key'
    and not (
      indexed.indisunique
      and indexed.indpred is null
      and indexed.indnkeyatts = 1
      and (
        select attribute.attname
        from pg_attribute attribute
        where attribute.attrelid = table_rel.oid
          and attribute.attnum = indexed.indkey[0]
      ) = 'treatment_id'
    );
  if incompatible_named > 0 then
    raise exception 'incompatible index member_treatment_publications_treatment_id_key exists; it was not replaced';
  end if;
end $$;

create or replace function public.insert_member_treatment_publication_once(
  p_treatment_id uuid,
  p_organization_id uuid,
  p_customer_id uuid,
  p_approved_fields jsonb,
  p_approved_by text
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.member_treatment_publications%rowtype;
begin
  if p_approved_by is null
     or p_approved_by !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    return 'unauthorized';
  end if;

  insert into public.member_treatment_publications (
    treatment_id, organization_id, customer_id, approved_fields,
    approved_by, approved_at, revoked_at, updated_at
  ) values (
    p_treatment_id, p_organization_id, p_customer_id, p_approved_fields,
    p_approved_by, now(), null, now()
  )
  on conflict (treatment_id) do nothing
  returning * into existing;

  if found then
    return 'inserted';
  end if;

  select * into existing
  from public.member_treatment_publications
  where treatment_id = p_treatment_id;

  if not found then
    return 'failed';
  end if;
  if existing.revoked_at is not null then
    return 'revoked';
  end if;
  if existing.organization_id is distinct from p_organization_id
     or existing.customer_id is distinct from p_customer_id
     or existing.approved_fields is distinct from p_approved_fields then
    return 'mismatch';
  end if;
  return 'already';
end;
$$;

revoke all on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, text)
  to service_role;

comment on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, text) is
  'Insert a member publication once. approved_by must be an auth user UUID stored as text. Conflict does not update, and a revoked row stays revoked.';

notify pgrst, 'reload schema';
