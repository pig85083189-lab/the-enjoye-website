-- =============================================================================
-- Phase 1C-6H.2P — Strategy B / RLS qualification (additive)
--
-- The published 20260928113000_beauty_os_operational_foundation.sql is immutable.
-- This file applies the branch-only Strategy B / helper / policy-qualification
-- delta that used to live as an in-place rewrite of that file.
--
-- Safe on:
--   * a DB that applied main's original 20260928113000
--   * Preview that already applied the rewritten 20260928113000
--
-- Additive only. No DROP / recreate of business tables. No business INSERTs.
-- Treatments policies stay on 20261004120000 (location-aware). This file does
-- not recreate them.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- current_organization_id: count-gated scalar. Do not aggregate uuid.
-- ---------------------------------------------------------------------------
create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select case
    when (
      select count(*)
      from public.staff_auth_memberships m
      join public.organizations o on o.app_id = m.organization_id
      where m.auth_user_id = auth.uid()
        and m.is_active = true
    ) = 1
    then (
      select o.id
      from public.staff_auth_memberships m
      join public.organizations o on o.app_id = m.organization_id
      where m.auth_user_id = auth.uid()
        and m.is_active = true
    )
    else null
  end;
$$;

-- ---------------------------------------------------------------------------
-- Qualify outer columns. Innermost FROM staff_auth_memberships shadows
-- unqualified organization_id as text app_id (uuid = text).
-- Actor on audit_logs must be staff_auth_memberships.user_id (staff-*),
-- never auth.users.id.
-- ---------------------------------------------------------------------------

drop policy if exists customers_select_org on public.customers;
drop policy if exists customers_insert_org on public.customers;
drop policy if exists customers_update_org on public.customers;
drop policy if exists customers_delete_org on public.customers;
create policy customers_select_org on public.customers for select to authenticated
  using (public.user_has_org_membership(customers.organization_id));
create policy customers_insert_org on public.customers for insert to authenticated
  with check (public.user_has_org_membership(customers.organization_id));
create policy customers_update_org on public.customers for update to authenticated
  using (public.user_has_org_membership(customers.organization_id))
  with check (public.user_has_org_membership(customers.organization_id));
create policy customers_delete_org on public.customers for delete to authenticated
  using (
    public.user_has_org_membership(customers.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(customers.organization_id))
  );

drop policy if exists customer_consultations_select_org on public.customer_consultations;
drop policy if exists customer_consultations_insert_org on public.customer_consultations;
drop policy if exists customer_consultations_update_org on public.customer_consultations;
drop policy if exists customer_consultations_delete_org on public.customer_consultations;
create policy customer_consultations_select_org on public.customer_consultations for select to authenticated
  using (public.user_has_org_membership(customer_consultations.organization_id));
create policy customer_consultations_insert_org on public.customer_consultations for insert to authenticated
  with check (public.user_has_org_membership(customer_consultations.organization_id));
create policy customer_consultations_update_org on public.customer_consultations for update to authenticated
  using (public.user_has_org_membership(customer_consultations.organization_id))
  with check (public.user_has_org_membership(customer_consultations.organization_id));
create policy customer_consultations_delete_org on public.customer_consultations for delete to authenticated
  using (public.user_has_org_membership(customer_consultations.organization_id));

drop policy if exists services_select_org on public.services;
drop policy if exists services_insert_org on public.services;
drop policy if exists services_update_org on public.services;
drop policy if exists services_delete_org on public.services;
create policy services_select_org on public.services for select to authenticated
  using (public.user_has_org_membership(services.organization_id));
create policy services_insert_org on public.services for insert to authenticated
  with check (public.user_has_org_membership(services.organization_id));
create policy services_update_org on public.services for update to authenticated
  using (public.user_has_org_membership(services.organization_id))
  with check (public.user_has_org_membership(services.organization_id));
create policy services_delete_org on public.services for delete to authenticated
  using (
    public.user_has_org_membership(services.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(services.organization_id))
  );

-- Appointments: keep 20261002 location-aware insert/update; qualify select/delete.
drop policy if exists appointments_select_org on public.appointments;
drop policy if exists appointments_insert_org on public.appointments;
drop policy if exists appointments_update_org on public.appointments;
drop policy if exists appointments_delete_org on public.appointments;
create policy appointments_select_org on public.appointments for select to authenticated
  using (
    public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(appointments.organization_id, appointments.location_id)
  );
create policy appointments_insert_org on public.appointments
  for insert to authenticated
  with check (
    appointments.location_id is not null
    and public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(
      appointments.organization_id,
      appointments.location_id
    )
  );
create policy appointments_update_org on public.appointments
  for update to authenticated
  using (
    public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(
      appointments.organization_id,
      appointments.location_id
    )
  )
  with check (
    appointments.location_id is not null
    and public.user_has_org_membership(appointments.organization_id)
    and public.user_can_access_location(
      appointments.organization_id,
      appointments.location_id
    )
  );
create policy appointments_delete_org on public.appointments for delete to authenticated
  using (
    public.user_has_org_membership(appointments.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(appointments.organization_id))
  );

drop policy if exists treatment_photos_select_org on public.treatment_photos;
drop policy if exists treatment_photos_insert_org on public.treatment_photos;
drop policy if exists treatment_photos_update_org on public.treatment_photos;
drop policy if exists treatment_photos_delete_org on public.treatment_photos;
create policy treatment_photos_select_org on public.treatment_photos for select to authenticated
  using (public.user_has_org_membership(treatment_photos.organization_id));
create policy treatment_photos_insert_org on public.treatment_photos for insert to authenticated
  with check (public.user_has_org_membership(treatment_photos.organization_id));
create policy treatment_photos_update_org on public.treatment_photos for update to authenticated
  using (public.user_has_org_membership(treatment_photos.organization_id))
  with check (public.user_has_org_membership(treatment_photos.organization_id));
create policy treatment_photos_delete_org on public.treatment_photos for delete to authenticated
  using (public.user_has_org_membership(treatment_photos.organization_id));

drop policy if exists organizations_select_own on public.organizations;
create policy organizations_select_own on public.organizations for select to authenticated
  using (public.user_has_org_membership(organizations.id));

drop policy if exists profiles_select_own_or_org on public.profiles;
create policy profiles_select_own_or_org on public.profiles for select to authenticated
  using (
    profiles.id = auth.uid()
    or public.user_has_org_membership(profiles.organization_id)
  );

drop policy if exists audit_logs_insert_org on public.audit_logs;
drop policy if exists audit_logs_select_managers on public.audit_logs;
create policy audit_logs_insert_org on public.audit_logs for insert to authenticated
  with check (
    public.user_has_org_membership(audit_logs.organization_id)
    and (
      audit_logs.actor_id is null
      or exists (
        select 1
        from public.staff_auth_memberships m
        join public.organizations o on m.organization_id = o.app_id
        where o.id = audit_logs.organization_id
          and m.user_id = audit_logs.actor_id
          and m.auth_user_id = auth.uid()
          and m.is_active = true
      )
    )
  );
create policy audit_logs_select_managers on public.audit_logs for select to authenticated
  using (
    public.user_has_org_membership(audit_logs.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(audit_logs.organization_id))
  );

drop policy if exists locations_insert_org on public.locations;
drop policy if exists locations_update_org on public.locations;
drop policy if exists locations_select_org on public.locations;
drop policy if exists locations_write_org on public.locations;
create policy locations_select_org on public.locations for select to authenticated
  using (public.user_has_org_membership(locations.organization_id));
create policy locations_insert_org on public.locations for insert to authenticated
  with check (
    public.user_has_org_membership(locations.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(locations.organization_id))
  );
create policy locations_update_org on public.locations for update to authenticated
  using (public.user_has_org_membership(locations.organization_id))
  with check (
    public.user_has_org_membership(locations.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(locations.organization_id))
  );

drop policy if exists staff_auth_memberships_select_org on public.staff_auth_memberships;
create policy staff_auth_memberships_select_org
on public.staff_auth_memberships
for select
to authenticated
using (
  staff_auth_memberships.auth_user_id = auth.uid()
  or exists (
    select 1
    from public.organizations o
    where o.app_id = staff_auth_memberships.organization_id
      and public.user_has_org_membership(o.id)
  )
);

drop policy if exists staff_auth_membership_locations_select_org
  on public.staff_auth_membership_locations;
create policy staff_auth_membership_locations_select_org
on public.staff_auth_membership_locations
for select
to authenticated
using (
  exists (
    select 1
    from public.staff_auth_memberships m
    join public.organizations o on m.organization_id = o.app_id
    where m.id = staff_auth_membership_locations.membership_id
      and (
        m.auth_user_id = auth.uid()
        or public.user_has_org_membership(o.id)
      )
  )
);

drop policy if exists products_select_org on public.products;
drop policy if exists products_insert_org on public.products;
drop policy if exists products_update_org on public.products;
create policy products_select_org on public.products for select to authenticated
  using (public.user_has_org_membership(products.organization_id));
create policy products_insert_org on public.products for insert to authenticated
  with check (public.user_has_org_membership(products.organization_id));
create policy products_update_org on public.products for update to authenticated
  using (public.user_has_org_membership(products.organization_id))
  with check (public.user_has_org_membership(products.organization_id));

drop policy if exists checkout_drafts_select_org on public.checkout_drafts;
drop policy if exists checkout_drafts_insert_org on public.checkout_drafts;
drop policy if exists checkout_drafts_update_org on public.checkout_drafts;
create policy checkout_drafts_select_org on public.checkout_drafts for select to authenticated
  using (public.user_has_org_membership(checkout_drafts.organization_id));
create policy checkout_drafts_insert_org on public.checkout_drafts for insert to authenticated
  with check (public.user_has_org_membership(checkout_drafts.organization_id));
create policy checkout_drafts_update_org on public.checkout_drafts for update to authenticated
  using (public.user_has_org_membership(checkout_drafts.organization_id))
  with check (public.user_has_org_membership(checkout_drafts.organization_id));

drop policy if exists checkout_items_select_org on public.checkout_items;
drop policy if exists checkout_items_insert_org on public.checkout_items;
drop policy if exists checkout_items_update_org on public.checkout_items;
drop policy if exists checkout_items_delete_org on public.checkout_items;
create policy checkout_items_select_org on public.checkout_items for select to authenticated
  using (public.user_has_org_membership(checkout_items.organization_id));
create policy checkout_items_insert_org on public.checkout_items for insert to authenticated
  with check (public.user_has_org_membership(checkout_items.organization_id));
create policy checkout_items_update_org on public.checkout_items for update to authenticated
  using (public.user_has_org_membership(checkout_items.organization_id))
  with check (public.user_has_org_membership(checkout_items.organization_id));
create policy checkout_items_delete_org on public.checkout_items for delete to authenticated
  using (public.user_has_org_membership(checkout_items.organization_id));

drop policy if exists checkout_discounts_select_org on public.checkout_discounts;
drop policy if exists checkout_discounts_insert_org on public.checkout_discounts;
drop policy if exists checkout_discounts_update_org on public.checkout_discounts;
drop policy if exists checkout_discounts_delete_org on public.checkout_discounts;
create policy checkout_discounts_select_org on public.checkout_discounts for select to authenticated
  using (public.user_has_org_membership(checkout_discounts.organization_id));
create policy checkout_discounts_insert_org on public.checkout_discounts for insert to authenticated
  with check (public.user_has_org_membership(checkout_discounts.organization_id));
create policy checkout_discounts_update_org on public.checkout_discounts for update to authenticated
  using (public.user_has_org_membership(checkout_discounts.organization_id))
  with check (public.user_has_org_membership(checkout_discounts.organization_id));
create policy checkout_discounts_delete_org on public.checkout_discounts for delete to authenticated
  using (public.user_has_org_membership(checkout_discounts.organization_id));

drop policy if exists checkout_payments_select_org on public.checkout_payments;
drop policy if exists checkout_payments_insert_org on public.checkout_payments;
drop policy if exists checkout_payments_update_org on public.checkout_payments;
drop policy if exists checkout_payments_delete_org on public.checkout_payments;
create policy checkout_payments_select_org on public.checkout_payments for select to authenticated
  using (public.user_has_org_membership(checkout_payments.organization_id));
create policy checkout_payments_insert_org on public.checkout_payments for insert to authenticated
  with check (public.user_has_org_membership(checkout_payments.organization_id));
create policy checkout_payments_update_org on public.checkout_payments for update to authenticated
  using (public.user_has_org_membership(checkout_payments.organization_id))
  with check (public.user_has_org_membership(checkout_payments.organization_id));
create policy checkout_payments_delete_org on public.checkout_payments for delete to authenticated
  using (public.user_has_org_membership(checkout_payments.organization_id));

drop policy if exists transactions_select_org on public.transactions;
drop policy if exists transactions_insert_org on public.transactions;
drop policy if exists transactions_update_org on public.transactions;
create policy transactions_select_org on public.transactions for select to authenticated
  using (public.user_has_org_membership(transactions.organization_id));
create policy transactions_insert_org on public.transactions for insert to authenticated
  with check (public.user_has_org_membership(transactions.organization_id));
create policy transactions_update_org on public.transactions for update to authenticated
  using (
    public.user_has_org_membership(transactions.organization_id)
    and public.staff_role_is_managerial(public.user_org_role(transactions.organization_id))
  )
  with check (public.user_has_org_membership(transactions.organization_id));

drop policy if exists transaction_items_select_org on public.transaction_items;
drop policy if exists transaction_items_insert_org on public.transaction_items;
create policy transaction_items_select_org on public.transaction_items for select to authenticated
  using (public.user_has_org_membership(transaction_items.organization_id));
create policy transaction_items_insert_org on public.transaction_items for insert to authenticated
  with check (public.user_has_org_membership(transaction_items.organization_id));

drop policy if exists transaction_discounts_select_org on public.transaction_discounts;
drop policy if exists transaction_discounts_insert_org on public.transaction_discounts;
create policy transaction_discounts_select_org on public.transaction_discounts for select to authenticated
  using (public.user_has_org_membership(transaction_discounts.organization_id));
create policy transaction_discounts_insert_org on public.transaction_discounts for insert to authenticated
  with check (public.user_has_org_membership(transaction_discounts.organization_id));

drop policy if exists transaction_payments_select_org on public.transaction_payments;
drop policy if exists transaction_payments_insert_org on public.transaction_payments;
create policy transaction_payments_select_org on public.transaction_payments for select to authenticated
  using (public.user_has_org_membership(transaction_payments.organization_id));
create policy transaction_payments_insert_org on public.transaction_payments for insert to authenticated
  with check (public.user_has_org_membership(transaction_payments.organization_id));

drop policy if exists package_definitions_select_org on public.package_definitions;
drop policy if exists package_definitions_insert_org on public.package_definitions;
drop policy if exists package_definitions_update_org on public.package_definitions;
create policy package_definitions_select_org on public.package_definitions for select to authenticated
  using (public.user_has_org_membership(package_definitions.organization_id));
create policy package_definitions_insert_org on public.package_definitions for insert to authenticated
  with check (public.user_has_org_membership(package_definitions.organization_id));
create policy package_definitions_update_org on public.package_definitions for update to authenticated
  using (public.user_has_org_membership(package_definitions.organization_id))
  with check (public.user_has_org_membership(package_definitions.organization_id));

drop policy if exists customer_packages_select_org on public.customer_packages;
drop policy if exists customer_packages_insert_org on public.customer_packages;
drop policy if exists customer_packages_update_org on public.customer_packages;
create policy customer_packages_select_org on public.customer_packages for select to authenticated
  using (public.user_has_org_membership(customer_packages.organization_id));
create policy customer_packages_insert_org on public.customer_packages for insert to authenticated
  with check (public.user_has_org_membership(customer_packages.organization_id));
create policy customer_packages_update_org on public.customer_packages for update to authenticated
  using (public.user_has_org_membership(customer_packages.organization_id))
  with check (public.user_has_org_membership(customer_packages.organization_id));

drop policy if exists package_ledger_select_org on public.package_ledger_entries;
drop policy if exists package_ledger_insert_org on public.package_ledger_entries;
create policy package_ledger_select_org on public.package_ledger_entries for select to authenticated
  using (public.user_has_org_membership(package_ledger_entries.organization_id));
create policy package_ledger_insert_org on public.package_ledger_entries for insert to authenticated
  with check (public.user_has_org_membership(package_ledger_entries.organization_id));

drop policy if exists stored_value_accounts_select_org on public.stored_value_accounts;
drop policy if exists stored_value_accounts_insert_org on public.stored_value_accounts;
drop policy if exists stored_value_accounts_update_org on public.stored_value_accounts;
create policy stored_value_accounts_select_org on public.stored_value_accounts for select to authenticated
  using (public.user_has_org_membership(stored_value_accounts.organization_id));
create policy stored_value_accounts_insert_org on public.stored_value_accounts for insert to authenticated
  with check (public.user_has_org_membership(stored_value_accounts.organization_id));
create policy stored_value_accounts_update_org on public.stored_value_accounts for update to authenticated
  using (public.user_has_org_membership(stored_value_accounts.organization_id))
  with check (public.user_has_org_membership(stored_value_accounts.organization_id));

drop policy if exists stored_value_ledger_select_org on public.stored_value_ledger_entries;
drop policy if exists stored_value_ledger_insert_org on public.stored_value_ledger_entries;
create policy stored_value_ledger_select_org on public.stored_value_ledger_entries for select to authenticated
  using (public.user_has_org_membership(stored_value_ledger_entries.organization_id));
create policy stored_value_ledger_insert_org on public.stored_value_ledger_entries for insert to authenticated
  with check (public.user_has_org_membership(stored_value_ledger_entries.organization_id));

drop policy if exists inventory_movements_select_org on public.inventory_movements;
drop policy if exists inventory_movements_insert_org on public.inventory_movements;
create policy inventory_movements_select_org on public.inventory_movements for select to authenticated
  using (public.user_has_org_membership(inventory_movements.organization_id));
create policy inventory_movements_insert_org on public.inventory_movements for insert to authenticated
  with check (public.user_has_org_membership(inventory_movements.organization_id));

drop policy if exists follow_up_tasks_select_org on public.follow_up_tasks;
drop policy if exists follow_up_tasks_insert_org on public.follow_up_tasks;
drop policy if exists follow_up_tasks_update_org on public.follow_up_tasks;
create policy follow_up_tasks_select_org on public.follow_up_tasks for select to authenticated
  using (public.user_has_org_membership(follow_up_tasks.organization_id));
create policy follow_up_tasks_insert_org on public.follow_up_tasks for insert to authenticated
  with check (public.user_has_org_membership(follow_up_tasks.organization_id));
create policy follow_up_tasks_update_org on public.follow_up_tasks for update to authenticated
  using (public.user_has_org_membership(follow_up_tasks.organization_id))
  with check (public.user_has_org_membership(follow_up_tasks.organization_id));
