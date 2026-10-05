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
-- PostgreSQL SQLSTATE 0A000:
--   cannot alter type of a column used in a policy definition
--
-- Catalog audit on a DB that has applied only 18120000–112950:
--   * The only policy that references actor_id is audit_logs_insert_org.
--   * audit_logs_select_managers references organization_id only.
--   * No view / trigger / function body depends on actor_id.
--   * No index on actor_id.
--   * audit_logs_actor_id_fkey is dropped by 113000 before the ALTER.
--   * Other 113000 uuid→text columns (appointments.staff_id / created_by,
--     treatments.staff_id, customer_consultations.created_by / updated_by,
--     treatment_photos.created_by) have no policy expressions on them.
--
-- This file only drops the blocking foundation insert policy while
-- actor_id is still uuid. It does not change the column type. It does
-- not recreate 113000. RLS stays enabled, so insert is fail-closed
-- until immutable 113000 rebuilds the policy.
--
-- Preview (actor_id already text after 113000) is a no-op.
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
