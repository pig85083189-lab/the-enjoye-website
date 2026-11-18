CREATE OR REPLACE FUNCTION public.assert_booking_source_actor(p_organization_id uuid, p_staff_id text, p_checkout boolean)
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_role public.staff_role;
  v_staff text;
begin
  if current_setting('role', true) = 'service_role' then
    if p_staff_id is null or not public.is_operational_staff_id(p_staff_id) then
      raise exception '沒有權限結帳';
    end if;
    return p_staff_id;
  end if;
  if auth.uid() is null then
    raise exception '沒有權限結帳';
  end if;
  v_role := public.user_org_role(p_organization_id);
  v_staff := public.current_operational_staff_id(p_organization_id);
  if v_role is null or v_staff is null or v_staff is distinct from p_staff_id then
    raise exception '沒有權限結帳';
  end if;
  if p_checkout then
    if v_role not in ('OWNER', 'MANAGER', 'STAFF', 'RECEPTIONIST') then
      raise exception '沒有權限結帳';
    end if;
  elsif not public.staff_role_is_managerial(v_role) then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  return v_staff;
end;
$function$;
revoke all on function public.assert_booking_source_actor(uuid,text,boolean) from public, anon, authenticated;
grant execute on function public.assert_booking_source_actor(uuid,text,boolean) to service_role;
