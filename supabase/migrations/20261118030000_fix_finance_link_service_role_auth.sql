CREATE OR REPLACE FUNCTION public.link_booking_source_from_verified_line(p_organization_app_id text, p_source_customer_key text, p_line_subject_hash text, p_auth_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid;
  v_org_app text;
  v_hash text := lower(btrim(coalesce(p_line_subject_hash, '')));
  v_key text := btrim(coalesce(p_source_customer_key, ''));
  v_line uuid;
  v_line_count integer := 0;
  v_any_count integer := 0;
  v_revoked_count integer := 0;
  v_booking uuid;
  v_identity_count integer := 0;
  v_existing uuid;
  v_existing_customer uuid;
  v_finance_taken uuid;
begin
  -- The legacy per-claim JWT GUC may be unset in modern PostgREST.
  -- This RPC must be called using PostgreSQL SET ROLE service_role.
  if p_auth_user_id is null
     or current_setting('role', true) is distinct from 'service_role' then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  if v_hash !~ '^[0-9a-f]{64}$' or char_length(v_key) < 8 or char_length(v_key) > 120 then
    raise exception '沒有權限建立顧客身分對應';
  end if;

  select organization_row.id, organization_row.app_id
    into v_org, v_org_app
  from public.organizations organization_row
  where organization_row.app_id = p_organization_app_id;
  if v_org is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;

  select count(*) into v_any_count
  from (
    select public.line_binding_customer_in_org(v_org, to_jsonb(binding)) as customer_id
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and public.line_binding_customer_in_org(v_org, to_jsonb(binding)) is not null
    union
    select member_link.customer_id
    from public.member_line_customer_links member_link
    where member_link.organization_id = v_org
      and member_link.line_subject_hash = v_hash
  ) subjects;

  select count(*) into v_line_count
  from public.current_line_subject_customers(v_org, v_org_app, v_hash);

  if v_line_count = 0 then
    select count(*) into v_revoked_count
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and (binding.status = 'unbound' or binding.unbound_at is not null or binding.blocked_at is not null)
      and not exists (
        select 1 from public.line_customer_bindings active_binding
        where active_binding.organization_id = binding.organization_id
          and public.line_binding_customer_in_org(v_org, to_jsonb(active_binding))
            = public.line_binding_customer_in_org(v_org, to_jsonb(binding))
          and active_binding.line_user_id_hash = binding.line_user_id_hash
          and active_binding.status = 'active'
          and active_binding.verified is true
          and active_binding.confirmed_at is not null
          and active_binding.bound_at is not null
          and active_binding.unbound_at is null
          and active_binding.blocked_at is null
          and active_binding.bound_at > coalesce(binding.unbound_at, binding.blocked_at, '-infinity'::timestamptz)
      );
    perform public.enqueue_member_binding_review(
      v_org, v_key, v_hash,
      case
        when v_revoked_count > 0 then 'LINE_REVOKED'
        when v_any_count > 0 then 'LINE_NOT_VERIFIED'
        else 'NO_TRUSTED_ASSOCIATION'
      end,
      p_auth_user_id
    );
    return jsonb_build_object('outcome', 'review', 'reasonCode',
      case
        when v_revoked_count > 0 then 'LINE_REVOKED'
        when v_any_count > 0 then 'LINE_NOT_VERIFIED'
        else 'NO_TRUSTED_ASSOCIATION'
      end);
  end if;

  if v_line_count <> 1 then
    perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'MULTIPLE_CUSTOMERS', p_auth_user_id);
    return jsonb_build_object('outcome', 'review', 'reasonCode', 'MULTIPLE_CUSTOMERS');
  end if;

  select subject.customer_id into v_line
  from public.current_line_subject_customers(v_org, v_org_app, v_hash) subject;

  if not exists (
    select 1 from public.customers customer_row
    where customer_row.id = v_line
      and customer_row.organization_id = v_org
      and customer_row.status = 'ACTIVE'
  ) then
    perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'ACCOUNT_DISABLED', p_auth_user_id);
    return jsonb_build_object('outcome', 'review', 'reasonCode', 'ACCOUNT_DISABLED');
  end if;

  select count(*) into v_identity_count
  from public.customer_wallet_identities identity_row
  where identity_row.organization_id = v_org
    and identity_row.status = 'ACTIVE'
    and (
      identity_row.wallet_customer_id = v_line
      or identity_row.booking_customer_id = v_line
    );

  if v_identity_count > 1 then
    perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'MULTIPLE_FINANCE_CUSTOMERS', p_auth_user_id);
    return jsonb_build_object('outcome', 'review', 'reasonCode', 'MULTIPLE_FINANCE_CUSTOMERS');
  end if;

  if v_identity_count = 1 then
    select identity_row.booking_customer_id into v_booking
    from public.customer_wallet_identities identity_row
    where identity_row.organization_id = v_org
      and identity_row.status = 'ACTIVE'
      and (
        identity_row.wallet_customer_id = v_line
        or identity_row.booking_customer_id = v_line
      );
  else
    v_booking := v_line;
  end if;

  if not exists (
    select 1 from public.customers customer_row
    where customer_row.id = v_booking
      and customer_row.organization_id = v_org
      and customer_row.status = 'ACTIVE'
  ) then
    perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'ACCOUNT_DISABLED', p_auth_user_id);
    return jsonb_build_object('outcome', 'review', 'reasonCode', 'ACCOUNT_DISABLED');
  end if;

  select link_row.id, link_row.finance_booking_customer_id
    into v_existing, v_existing_customer
  from public.booking_source_customer_links link_row
  where link_row.organization_id = v_org
    and link_row.source_customer_key = v_key
    and link_row.status = 'ACTIVE';
  if v_existing is not null and v_existing_customer is distinct from v_booking then
    perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'LINK_CONFLICT', p_auth_user_id);
    return jsonb_build_object('outcome', 'review', 'reasonCode', 'LINK_CONFLICT');
  end if;
  if v_existing is not null then
    return jsonb_build_object('outcome', 'already_linked', 'reasonCode', 'LINE_VERIFIED_SESSION');
  end if;

  select link_row.id into v_finance_taken
  from public.booking_source_customer_links link_row
  where link_row.organization_id = v_org
    and link_row.finance_booking_customer_id = v_booking
    and link_row.status = 'ACTIVE'
    and link_row.source_customer_key <> v_key;
  if v_finance_taken is not null then
    perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'LINK_CONFLICT', p_auth_user_id);
    return jsonb_build_object('outcome', 'review', 'reasonCode', 'LINK_CONFLICT');
  end if;

  begin
    insert into public.booking_source_customer_links (
      organization_id, source_customer_key, finance_booking_customer_id,
      evidence_kind, reason, confirmed_by_staff_id, confirmed_by_auth_user_id, link_origin
    ) values (
      v_org, v_key, v_booking,
      'LINE_VERIFIED_SESSION', '員工依現行 LINE 綁定證據建立對應',
      null, p_auth_user_id, 'LINE_VERIFIED_SESSION'
    );
  exception
    when unique_violation then
      select link_row.finance_booking_customer_id into v_existing_customer
      from public.booking_source_customer_links link_row
      where link_row.organization_id = v_org
        and link_row.source_customer_key = v_key
        and link_row.status = 'ACTIVE';
      if v_existing_customer = v_booking then
        return jsonb_build_object('outcome', 'already_linked', 'reasonCode', 'LINE_VERIFIED_SESSION');
      end if;
      perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'LINK_CONFLICT', p_auth_user_id);
      return jsonb_build_object('outcome', 'review', 'reasonCode', 'LINK_CONFLICT');
    when others then
      if sqlerrm = '顧客帳號無效' then
        perform public.enqueue_member_binding_review(v_org, v_key, v_hash, 'LINK_CONFLICT', p_auth_user_id);
        return jsonb_build_object('outcome', 'review', 'reasonCode', 'LINK_CONFLICT');
      end if;
      raise;
  end;

  return jsonb_build_object('outcome', 'linked', 'reasonCode', 'LINE_VERIFIED_SESSION');
end;
$function$;

revoke all on function public.link_booking_source_from_verified_line(text,text,text,uuid) from public, anon, authenticated;
grant execute on function public.link_booking_source_from_verified_line(text,text,text,uuid) to service_role;
