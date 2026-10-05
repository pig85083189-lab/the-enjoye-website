-- =============================================================================
-- Phase 1C-6H.2P — Commerce table write hardening
--
-- Direct authenticated table writes on checkout / transaction mutation tables
-- are revoked. Settlement mutations stay on security definer RPCs:
--   hydrate_checkout_from_treatment
--   save_checkout_draft
--   settle_checkout_draft
--
-- SELECT stays granted so Transaction read (including ACCOUNTANT) still works
-- through RLS. ACCOUNTANT remains denied on checkout RPCs via
-- staff_role_can_checkout.
--
-- Additive. No DROP / recreate of business tables. No business INSERTs.
-- Package / Stored Value remote settlement stays disabled in 20261005120000.
-- =============================================================================

drop policy if exists checkout_drafts_insert_org on public.checkout_drafts;
drop policy if exists checkout_drafts_update_org on public.checkout_drafts;

drop policy if exists checkout_items_insert_org on public.checkout_items;
drop policy if exists checkout_items_update_org on public.checkout_items;
drop policy if exists checkout_items_delete_org on public.checkout_items;

drop policy if exists checkout_discounts_insert_org on public.checkout_discounts;
drop policy if exists checkout_discounts_update_org on public.checkout_discounts;
drop policy if exists checkout_discounts_delete_org on public.checkout_discounts;

drop policy if exists checkout_payments_insert_org on public.checkout_payments;
drop policy if exists checkout_payments_update_org on public.checkout_payments;
drop policy if exists checkout_payments_delete_org on public.checkout_payments;

drop policy if exists transactions_insert_org on public.transactions;
drop policy if exists transactions_update_org on public.transactions;

drop policy if exists transaction_items_insert_org on public.transaction_items;
drop policy if exists transaction_discounts_insert_org on public.transaction_discounts;
drop policy if exists transaction_payments_insert_org on public.transaction_payments;

revoke all on public.checkout_drafts from public, anon, authenticated;
revoke all on public.checkout_items from public, anon, authenticated;
revoke all on public.checkout_discounts from public, anon, authenticated;
revoke all on public.checkout_payments from public, anon, authenticated;
revoke all on public.transactions from public, anon, authenticated;
revoke all on public.transaction_items from public, anon, authenticated;
revoke all on public.transaction_discounts from public, anon, authenticated;
revoke all on public.transaction_payments from public, anon, authenticated;

grant select on public.checkout_drafts to authenticated;
grant select on public.checkout_items to authenticated;
grant select on public.checkout_discounts to authenticated;
grant select on public.checkout_payments to authenticated;
grant select on public.transactions to authenticated;
grant select on public.transaction_items to authenticated;
grant select on public.transaction_discounts to authenticated;
grant select on public.transaction_payments to authenticated;
