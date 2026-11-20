-- Review only. Schema rollback, separate from reverting the application commits.
-- Run only on the finance project after a backup, and only when explicitly authorized.
-- This pull request does not execute this file.
--
-- Drops the new function and, only when the mirror table is empty, that table
-- and the unique index created under this exact name.
-- If member_treatment_mirrors already has rows, this script stops and drops
-- nothing. Those rows are production member copies and are not deleted here.
-- It never deletes treatments, customers, appointments, wallets, or
-- existing member_treatment_publications rows.

do $$
declare
  existing_rows bigint;
begin
  if to_regclass('public.member_treatment_mirrors') is not null then
    execute 'select count(*) from public.member_treatment_mirrors' into existing_rows;
    if existing_rows > 0 then
      raise exception 'member_treatment_mirrors already contains rows; refusing to drop them';
    end if;
  end if;
end $$;

drop function if exists public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid);
drop table if exists public.member_treatment_mirrors;
drop index if exists public.member_treatment_publications_treatment_id_key;

notify pgrst, 'reload schema';
