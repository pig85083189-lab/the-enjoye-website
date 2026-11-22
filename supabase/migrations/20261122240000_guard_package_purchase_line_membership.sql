-- Enforce the same current LINE membership rule used by stored-value at the final package write boundary.
-- This is scoped to customer_packages INSERT and does not change existing checkout UI.
create or replace function public.guard_package_purchase_line_membership()
returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
 if not public.customer_line_membership_is_current(new.organization_id,new.customer_id) then
   raise exception '顧客尚未完成有效 LINE 會員綁定，無法購買套票';
 end if;
 return new;
end $$;
revoke all on function public.guard_package_purchase_line_membership() from public,anon,authenticated;
drop trigger if exists trg_guard_package_purchase_line_membership on public.customer_packages;
create trigger trg_guard_package_purchase_line_membership before insert on public.customer_packages for each row execute function public.guard_package_purchase_line_membership();
