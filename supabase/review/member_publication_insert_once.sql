-- Review only. This file is not in supabase/migrations and is not applied
-- to production by this pull request.
-- Automatic member publication is one database statement.
-- A conflicting treatment_id does nothing, so a revoked row cannot be revived
-- and a different customer cannot take over the row.

do $$
declare
  duplicate_ids bigint;
  approver_type text;
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
    raise exception 'member_treatment_publications already has duplicate treatment_id values; unique index was not created';
  end if;

  select data_type into approver_type
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'member_treatment_publications'
    and column_name = 'approved_by';
  if approver_type is distinct from 'uuid' then
    raise exception 'approved_by must be uuid before this function is applied; found %', coalesce(approver_type, 'missing');
  end if;
end $$;

create unique index if not exists member_treatment_publications_treatment_id_key
  on public.member_treatment_publications (treatment_id);

do $$
declare index_ok boolean;
begin
  select exists (
    select 1
    from pg_index indexed
    join pg_class index_rel on index_rel.oid = indexed.indexrelid
    join pg_class table_rel on table_rel.oid = indexed.indrelid
    join pg_namespace namespace on namespace.oid = table_rel.relnamespace
    where namespace.nspname = 'public'
      and table_rel.relname = 'member_treatment_publications'
      and index_rel.relname = 'member_treatment_publications_treatment_id_key'
      and indexed.indisunique
      and indexed.indpred is null
      and indexed.indnkeyatts = 1
      and (
        select attribute.attname
        from pg_attribute attribute
        where attribute.attrelid = table_rel.oid
          and attribute.attnum = indexed.indkey[0]
      ) = 'treatment_id'
  ) into index_ok;
  if not index_ok then
    raise exception 'publication unique index must be exactly unique (treatment_id) with no predicate';
  end if;
end $$;

create or replace function public.insert_member_treatment_publication_once(
  p_treatment_id uuid,
  p_organization_id uuid,
  p_customer_id uuid,
  p_approved_fields jsonb,
  p_approved_by uuid
) returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  existing public.member_treatment_publications%rowtype;
begin
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

revoke all on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid)
  from public, anon, authenticated;
grant execute on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid)
  to service_role;

comment on function public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid) is
  'Insert a member publication once. Conflict does not update, and a revoked row stays revoked.';

notify pgrst, 'reload schema';
