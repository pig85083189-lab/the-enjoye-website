-- =============================================================================
-- Finance V1C — Expense WRITE hardening (additive)
--
-- Preview already applied 20261007120000 (SELECT + INSERT).
-- This cut closes INSERT at the database so Production read-first
-- cannot accidentally write merely because the foundation exists.
--
-- SELECT grant + expenses_select_org + RLS stay open.
-- Enum usage stays granted. Table and existing rows are untouched.
-- UPDATE / DELETE stay closed. No business INSERTs / seed.
-- Do not rewrite 20261007120000.
-- =============================================================================

revoke insert on public.expenses from authenticated;

drop policy if exists expenses_insert_org on public.expenses;
drop policy if exists expenses_update_org on public.expenses;
drop policy if exists expenses_delete_org on public.expenses;

revoke update, delete on public.expenses from public, anon, authenticated;

grant select on public.expenses to authenticated;
grant usage on type public.expense_category to authenticated;
grant usage on type public.expense_payment_method to authenticated;

comment on table public.expenses is
  'Finance V1C money-out. Income stays on public.transactions. SELECT only. INSERT / UPDATE / DELETE closed.';
