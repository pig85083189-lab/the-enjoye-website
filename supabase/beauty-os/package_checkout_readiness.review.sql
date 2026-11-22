-- Read-only installation readiness checks for package checkout integration.
-- Safe to run against production: no customer, payment or ledger writes.
select 'package_definitions' as object_name, count(*)::bigint as row_count from public.package_definitions
union all select 'customer_packages', count(*) from public.customer_packages
union all select 'package_ledger_entries', count(*) from public.package_ledger_entries;

select p.proname, pg_get_function_identity_arguments(p.oid) as arguments,
       has_function_privilege('anon',p.oid,'EXECUTE') as anon_can_execute,
       has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_can_execute,
       has_function_privilege('service_role',p.oid,'EXECUTE') as service_can_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
  and p.proname in ('issue_customer_package_v1','redeem_customer_package_v1')
order by p.proname;

select indexname,indexdef from pg_indexes
where schemaname='public' and tablename='package_ledger_entries'
  and indexname='idx_package_ledger_org_effect_key';

-- Required integration invariant: the booking checkout RPC must atomically
-- create its completed transaction and matching package ledger effect.
-- Do not enable PACKAGE in checkout until the transaction boundary is proven.
