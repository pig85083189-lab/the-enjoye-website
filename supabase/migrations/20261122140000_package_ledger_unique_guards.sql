-- Defense in depth for package ledger invariants.
-- A settled checkout cannot issue the same package twice, even if a future
-- caller accidentally uses a different effect_key.
create unique index if not exists ux_customer_package_purchase_transaction_definition
on public.customer_packages (organization_id,purchase_transaction_id,package_definition_id)
where purchase_transaction_id is not null;

-- Only one active redemption for a given customer package and transaction.
-- Reversal entries are independent and remain append-only.
create unique index if not exists ux_package_redemption_transaction
on public.package_ledger_entries (organization_id,customer_package_id,transaction_id)
where type='REDEMPTION' and transaction_id is not null;

-- Preflight to run before applying this migration in an environment with
-- historical records:
-- select organization_id,purchase_transaction_id,package_definition_id,count(*)
-- from public.customer_packages where purchase_transaction_id is not null
-- group by 1,2,3 having count(*)>1;
-- select organization_id,customer_package_id,transaction_id,count(*)
-- from public.package_ledger_entries
-- where type='REDEMPTION' and transaction_id is not null
-- group by 1,2,3 having count(*)>1;
