-- Review only. Schema rollback, separate from reverting the application commits.
-- Run only on the finance project after a backup, and only when explicitly authorized.
-- This pull request does not execute this file.
--
-- Drops the new function, the new mirror table, and the unique index
-- created under this exact name. It does not delete treatments, customers,
-- appointments, wallets, or existing member_treatment_publications rows.

drop function if exists public.insert_member_treatment_publication_once(uuid, uuid, uuid, jsonb, uuid);
drop table if exists public.member_treatment_mirrors;
drop index if exists public.member_treatment_publications_treatment_id_key;

notify pgrst, 'reload schema';
