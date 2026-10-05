-- =============================================================================
-- Phase 1C-6H.2P2A — Fresh-DB compatibility bridge (pre-113000)
--
-- Fresh order:
--   20260918120000 foundation
--     creates public.audit_logs.actor_id uuid
--     and policy audit_logs_insert_org:
--       organization_id = current_organization_id()
--       and (actor_id is null or actor_id = auth.uid())
--   20260928112900 enum adapt
--   20260928112950 staff_auth_memberships
--   THIS FILE
--   20260928113000 operational foundation (immutable)
--     converts actor_id from uuid to operational text
--     then recreates audit_logs_insert_org for staff-*
--   20261006120000 Strategy B qualification (final RLS)
--
-- Catalog audit on a DB that has applied only 18120000–112950:
--   1) Policy audit_logs_insert_org is the only object that blocks
--      actor_id uuid → text (SQLSTATE 0A000).
--      audit_logs_select_managers does not reference actor_id.
--      No view / trigger / function / index depends on actor_id.
--      audit_logs_actor_id_fkey is dropped by 113000 before the conversion.
--      Other 113000 uuid→text columns have no policy expressions on them.
--   2) Immutable 113000 current_organization_id() uses min(o.id) on uuid.
--      Stock PostgreSQL / Supabase has no min(uuid), so CREATE FUNCTION
--      fails after the policy is gone. This file adds a public.min(uuid)
--      aggregate only. It does not replace current_organization_id.
--      20261006120000 later installs the count-gated Strategy B helper.
--
-- Preview: actor_id is already text, so the policy drop is a no-op.
-- min(uuid) is created only when missing.
--
-- Fail-closed: RLS stays enabled; insert policy is absent until 113000.
-- Additive. No DROP TABLE. No business INSERT / seed / QA copy.
-- =============================================================================

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'audit_logs'
      and column_name = 'actor_id'
      and data_type = 'uuid'
  ) then
    drop policy if exists audit_logs_insert_org on public.audit_logs;
  end if;
end
$$;

create or replace function public.uuid_min_state(left_id uuid, right_id uuid)
returns uuid
language sql
immutable
as $$
  select case
    when left_id is null then right_id
    when right_id is null then left_id
    when left_id < right_id then left_id
    else right_id
  end;
$$;

do $$
begin
  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'min'
      and p.prokind = 'a'
      and pg_get_function_identity_arguments(p.oid) = 'uuid'
  ) then
    create aggregate public.min(uuid) (
      sfunc = public.uuid_min_state,
      stype = uuid,
      combinefunc = public.uuid_min_state,
      sortop = <
    );
  end if;
end
$$;
