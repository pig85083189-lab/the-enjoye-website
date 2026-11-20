-- Read-only preflight for the finance project bfzquejrtgqzzarhkiya.
-- Run in the Supabase SQL editor as a session that can read catalogs.
-- Do not add INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, or GRANT.
-- This pull request does not execute this file.
--
-- How to read the result. A count of 0 is not the same as a missing table.
-- publications_table_exists false means the publications table is absent.
-- Before the unique index is created, publications_unique_exact = 0 together
-- with duplicate_treatment_ids = 0 can be a valid precondition. Also require
-- same_name_index_count = 0, and read publication_index_definitions: there
-- must be no index of this name and no other unique index on a different
-- column set. If publications_unique_exact = 1, the definition must be
-- exactly UNIQUE (treatment_id) with no predicate.
-- approved_by_type comes from information_schema.columns.data_type.
-- The expected column type is uuid. Null means the column is missing.
-- It is never a count of publication rows.
-- customers_id_org_unique = 1 is required before the mirror foreign key.
-- mirror_table_exists and publication_function_exists are false until the
-- review SQL has been applied.

select
  (to_regclass('public.member_treatment_publications') is not null) as publications_table_exists,
  (
    select count(*)
    from pg_class index_rel
    join pg_namespace namespace on namespace.oid = index_rel.relnamespace
    where namespace.nspname = 'public'
      and index_rel.relkind = 'i'
      and index_rel.relname = 'member_treatment_publications_treatment_id_key'
  ) as same_name_index_count,
  (
    select coalesce(string_agg(pg_get_indexdef(index_rel.oid), ' | ' order by index_rel.relname), '')
    from pg_index indexed
    join pg_class index_rel on index_rel.oid = indexed.indexrelid
    join pg_class table_rel on table_rel.oid = indexed.indrelid
    join pg_namespace namespace on namespace.oid = table_rel.relnamespace
    where namespace.nspname = 'public'
      and table_rel.relname = 'member_treatment_publications'
  ) as publication_index_definitions,
  (
    select count(*)
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
      ) = 'treatment_id'
  ) as publications_unique_exact,
  (
    select count(*)
    from (
      select treatment_id
      from public.member_treatment_publications
      group by treatment_id
      having count(*) > 1
    ) duplicates
  ) as duplicate_treatment_ids,
  (
    select count(*)
    from pg_constraint constraint_row
    join pg_class table_rel on table_rel.oid = constraint_row.conrelid
    join pg_namespace namespace on namespace.oid = table_rel.relnamespace
    where namespace.nspname = 'public'
      and table_rel.relname = 'customers'
      and constraint_row.contype in ('p', 'u')
      and (
        select array_agg(attribute.attname::text order by key_column.ord)
        from unnest(constraint_row.conkey) with ordinality as key_column(attnum, ord)
        join pg_attribute attribute
          on attribute.attrelid = table_rel.oid
         and attribute.attnum = key_column.attnum
      ) = array['id', 'organization_id']
  ) as customers_id_org_unique,
  (
    select data_type
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_treatment_publications'
      and column_name = 'approved_by'
  ) as approved_by_type,
  (
    select udt_name
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'member_treatment_publications'
      and column_name = 'approved_by'
  ) as approved_by_udt,
  (to_regclass('public.member_treatment_mirrors') is not null) as mirror_table_exists,
  (to_regprocedure('public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,uuid)') is not null) as publication_function_exists;
