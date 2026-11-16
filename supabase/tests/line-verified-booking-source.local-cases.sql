-- Isolated LINE booking-source cases. No production customer ids and no wallet debit.
do $$
declare
  v_org uuid := '11111111-1111-4111-8111-111111111111';
  v_other uuid := '22222222-2222-4222-8222-222222222222';
  v_booking uuid := 'f44fffff-ffff-4fff-8fff-ffffffffffff';
  v_wallet uuid := 'f55fffff-ffff-4fff-8fff-ffffffffffff';
  v_second uuid := 'f66fffff-ffff-4fff-8fff-ffffffffffff';
  v_disabled uuid := 'f77fffff-ffff-4fff-8fff-ffffffffffff';
  v_owner uuid := '99999999-9999-4999-8999-999999999999';
  v_staff uuid := '88888888-8888-4888-8888-888888888888';
  v_hash text := repeat('ab', 32);
  v_revoked text := repeat('cd', 32);
  v_disabled_hash text := repeat('ef', 32);
  v_other_hash text := repeat('12', 32);
  v_result jsonb;
  v_request uuid;
begin
  insert into public.organizations (id, app_id)
  values (v_other, 'org-other')
  on conflict (id) do nothing;

  insert into public.customers (id, organization_id, status, app_id) values
    (v_booking, v_org, 'ACTIVE', 'cust-line-booking'),
    (v_wallet, v_org, 'ACTIVE', 'cust-line-wallet'),
    (v_second, v_org, 'ACTIVE', 'cust-line-second'),
    (v_disabled, v_org, 'INACTIVE', 'cust-line-disabled');

  insert into public.customer_wallet_identities (
    organization_id, booking_customer_id, wallet_customer_id, status, reason, confirmed_by_staff_id
  ) values (
    v_org, v_booking, v_wallet, 'ACTIVE', '隔離測試已核對可信會員', 'staff-owner-test'
  );

  insert into public.line_customer_bindings (
    organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
  ) values (
    'org-stored-value-test', v_wallet, 'active', true, now(), now(), v_hash
  );

  perform set_config('tests.uid', v_owner::text, false);
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-line-0001', v_hash, v_owner
  );
  if v_result->>'outcome' <> 'linked' then
    raise exception 'unique verified LINE subject did not link: %', v_result;
  end if;
  if (
    select count(*) from public.booking_source_customer_links
    where source_customer_key = 'src-line-0001'
      and finance_booking_customer_id = v_booking
      and evidence_kind = 'LINE_VERIFIED_SESSION'
      and link_origin = 'LINE_VERIFIED_SESSION'
      and confirmed_by_staff_id is null
      and status = 'ACTIVE'
  ) <> 1 then
    raise exception 'verified LINE link was not stored once';
  end if;

  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-line-0001', v_hash, v_owner
  );
  if v_result->>'outcome' <> 'already_linked'
     or (select count(*) from public.booking_source_customer_links where source_customer_key = 'src-line-0001') <> 1 then
    raise exception 'repeated LINE login created another link';
  end if;

  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'cust-line-wallet', v_hash, v_owner
  );
  if v_result->>'reasonCode' <> 'LINK_CONFLICT'
     or exists (
       select 1 from public.booking_source_customer_links where source_customer_key = 'cust-line-wallet'
     ) then
    raise exception 'conflicting source key was stored';
  end if;

  insert into public.line_customer_bindings (
    organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
  ) values (
    'org-stored-value-test', v_second, 'active', true, now(), now(), v_hash
  );
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-line-many', v_hash, v_owner
  );
  if v_result->>'reasonCode' <> 'MULTIPLE_CUSTOMERS'
     or exists (
       select 1 from public.booking_source_customer_links where source_customer_key = 'src-line-many'
     ) then
    raise exception 'multiple LINE customers were linked';
  end if;

  insert into public.line_customer_bindings (
    organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
  ) values (
    'org-stored-value-test', v_disabled, 'active', true, now(), now(), v_disabled_hash
  );
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-line-disabled', v_disabled_hash, v_owner
  );
  if v_result->>'reasonCode' <> 'ACCOUNT_DISABLED' then
    raise exception 'disabled customer was accepted: %', v_result;
  end if;

  insert into public.line_customer_bindings (
    organization_id, customer_uuid, status, verified, confirmed_at, bound_at, unbound_at, line_user_id_hash
  ) values (
    'org-stored-value-test', v_wallet, 'unbound', false, null, null, now(), v_revoked
  );
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-line-revoked', v_revoked, v_owner
  );
  if v_result->>'reasonCode' <> 'LINE_REVOKED' then
    raise exception 'revoked LINE binding was accepted: %', v_result;
  end if;

  insert into public.customers (id, organization_id, status, app_id)
  values ('f88fffff-ffff-4fff-8fff-ffffffffffff', v_other, 'ACTIVE', 'cust-other-org');
  insert into public.line_customer_bindings (
    organization_id, customer_uuid, status, verified, confirmed_at, bound_at, line_user_id_hash
  ) values (
    'org-other', 'f88fffff-ffff-4fff-8fff-ffffffffffff', 'active', true, now(), now(), v_other_hash
  );
  v_result := public.link_booking_source_from_verified_line(
    'org-stored-value-test', 'src-line-other-org', v_other_hash, v_owner
  );
  if v_result->>'reasonCode' <> 'NO_TRUSTED_ASSOCIATION' then
    raise exception 'cross-organization LINE subject was accepted: %', v_result;
  end if;

  if exists (
    select 1 from public.booking_source_customer_links
    where evidence_kind = 'LINE_VERIFIED_SESSION'
      and source_customer_key <> 'src-line-0001'
  ) then
    raise exception 'a review outcome created a usable stored-value link';
  end if;

  select id into v_request
  from public.member_binding_requests
  where source_customer_key = 'src-line-revoked' and status = 'PENDING';
  if v_request is null then
    raise exception 'revoked LINE login did not create a review request';
  end if;

  insert into public.staff_auth_memberships (id, user_id, auth_user_id, organization_id, role, is_active)
  values
    ('mem-line-owner', 'staff-owner-test', v_owner, 'org-stored-value-test', 'OWNER', true),
    ('mem-line-staff', 'staff-desk-test', v_staff, 'org-stored-value-test', 'STAFF', true);

  perform set_config('tests.uid', v_staff::text, false);
  begin
    perform public.decide_member_binding_request(v_request, 'APPROVED', v_staff);
    raise exception 'staff approved a binding review';
  exception
    when others then
      if sqlerrm <> '沒有權限建立顧客身分對應' then
        raise;
      end if;
  end;

  perform set_config('request.jwt.claim.role', 'service_role', true);
  perform set_config('tests.uid', v_owner::text, false);
  begin
    perform public.decide_member_binding_request(v_request, 'APPROVED', v_owner);
    raise exception 'service role impersonated a manager review';
  exception
    when others then
      if sqlerrm <> '沒有權限建立顧客身分對應' then
        raise;
      end if;
  end;
  perform set_config('request.jwt.claim.role', '', true);

  perform set_config('tests.uid', v_owner::text, false);
  perform public.decide_member_binding_request(v_request, 'REJECTED', v_owner);
  if (select status from public.member_binding_requests where id = v_request) <> 'REJECTED'
     or exists (
       select 1 from public.booking_source_customer_links where source_customer_key = 'src-line-revoked'
     ) then
    raise exception 'manager review created a stored-value link';
  end if;

  perform set_config('tests.uid', '', false);
  begin
    perform public.link_booking_source_from_verified_line(
      'org-stored-value-test', 'src-line-anon', v_hash, v_owner
    );
    raise exception 'anonymous caller created a link';
  exception
    when others then
      if sqlerrm <> '沒有權限建立顧客身分對應' then
        raise;
      end if;
  end;

  if pg_get_functiondef('public.link_booking_source_from_verified_line(text,text,text,uuid)'::regprocedure)
       ~* 'full_name|phone' then
    raise exception 'LINE link function reads a personal attribute';
  end if;
end $$;
