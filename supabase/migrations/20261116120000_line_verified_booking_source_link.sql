-- Additive finance-database link for a verified LINE subject.
-- Does not replace save_checkout_draft, settle_checkout_draft, or the
-- managerial confirm function. Does not update ledger, appointment, package,
-- or historical identity rows. A pending review does not grant stored value.
-- Apply on the finance database only after the booking-source migration.
-- Do not apply to production in this phase.

alter table public.booking_source_customer_links
  alter column confirmed_by_staff_id drop not null;

alter table public.booking_source_customer_links
  add column if not exists link_origin text not null default 'MANAGER_REVIEW';

alter table public.booking_source_customer_links
  drop constraint if exists booking_source_customer_links_evidence;
alter table public.booking_source_customer_links
  add constraint booking_source_customer_links_evidence check (
    evidence_kind in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD', 'LINE_VERIFIED_SESSION')
  );

alter table public.booking_source_customer_links
  drop constraint if exists booking_source_customer_links_staff;
alter table public.booking_source_customer_links
  add constraint booking_source_customer_links_staff check (
    (
      evidence_kind = 'LINE_VERIFIED_SESSION'
      and confirmed_by_staff_id is null
      and link_origin = 'LINE_VERIFIED_SESSION'
    )
    or (
      evidence_kind in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD')
      and link_origin = 'MANAGER_REVIEW'
      and public.is_operational_staff_id(confirmed_by_staff_id)
    )
  );

alter table public.booking_source_customer_links
  drop constraint if exists booking_source_customer_links_origin;
alter table public.booking_source_customer_links
  add constraint booking_source_customer_links_origin check (
    link_origin in ('MANAGER_REVIEW', 'LINE_VERIFIED_SESSION')
  );

create table if not exists public.member_line_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  verified_at timestamptz,
  line_subject_hash text,
  unique (organization_id, customer_id)
);

alter table public.member_line_customer_links
  add column if not exists line_subject_hash text;

create table if not exists public.member_binding_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete restrict,
  line_subject_hash text,
  source_customer_key text,
  status text not null default 'PENDING',
  reason_code text not null,
  requested_by_auth_user_id uuid not null,
  reviewed_by_staff_id text,
  reviewed_by_auth_user_id uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint member_binding_requests_status check (status in ('PENDING', 'APPROVED', 'REJECTED')),
  constraint member_binding_requests_reason check (reason_code in (
    'LINE_NOT_VERIFIED', 'LINE_REVOKED', 'MULTIPLE_LINE_SUBJECTS', 'MULTIPLE_CUSTOMERS',
    'MULTIPLE_FINANCE_CUSTOMERS', 'ORG_MISMATCH', 'LINK_CONFLICT', 'ACCOUNT_DISABLED',
    'NO_TRUSTED_ASSOCIATION'
  )),
  constraint member_binding_requests_hash check (
    line_subject_hash is null or line_subject_hash ~ '^[0-9a-f]{64}$'
  ),
  constraint member_binding_requests_key check (
    source_customer_key is null or char_length(btrim(source_customer_key)) between 8 and 120
  ),
  constraint member_binding_requests_reviewer check (
    reviewed_by_staff_id is null or public.is_operational_staff_id(reviewed_by_staff_id)
  )
);

create unique index if not exists member_binding_requests_pending_key
  on public.member_binding_requests (organization_id, source_customer_key, reason_code)
  where status = 'PENDING' and source_customer_key is not null;

alter table public.member_binding_requests enable row level security;
revoke all on public.member_binding_requests from public, anon, authenticated;

create or replace function public.enqueue_member_binding_review(
  p_organization_id uuid,
  p_source_customer_key text,
  p_line_subject_hash text,
  p_reason_code text,
  p_auth_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  insert into public.member_binding_requests (
    organization_id, line_subject_hash, source_customer_key, reason_code, requested_by_auth_user_id
  ) values (
    p_organization_id,
    nullif(p_line_subject_hash, ''),
    nullif(btrim(p_source_customer_key), ''),
    p_reason_code,
    p_auth_user_id
  )
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    return v_id;
  end if;
  select request_row.id into v_id
  from public.member_binding_requests request_row
  where request_row.organization_id = p_organization_id
    and request_row.source_customer_key = btrim(p_source_customer_key)
    and request_row.reason_code = p_reason_code
    and request_row.status = 'PENDING'
  limit 1;
  return v_id;
end;
$$;

create or replace function public.link_booking_source_from_verified_line(
  p_organization_app_id text,
  p_source_customer_key text,
  p_line_subject_hash text,
  p_auth_user_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
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
  if p_auth_user_id is null
     or coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
        and p_auth_user_id is distinct from auth.uid() then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  if coalesce(current_setting('request.jwt.claim.role', true), '') <> 'service_role'
     and auth.uid() is null then
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
    select binding.customer_uuid as customer_id
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and binding.customer_uuid is not null
    union
    select member_link.customer_id
    from public.member_line_customer_links member_link
    where member_link.organization_id = v_org
      and member_link.line_subject_hash = v_hash
  ) subjects;

  select count(*) into v_line_count
  from (
    select binding.customer_uuid as customer_id
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and binding.customer_uuid is not null
      and binding.status = 'active'
      and binding.verified is true
      and binding.confirmed_at is not null
      and binding.bound_at is not null
      and binding.unbound_at is null
      and binding.blocked_at is null
    union
    select member_link.customer_id
    from public.member_line_customer_links member_link
    where member_link.organization_id = v_org
      and member_link.line_subject_hash = v_hash
      and member_link.verified_at is not null
  ) subjects;

  if v_line_count = 0 then
    select count(*) into v_revoked_count
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and (binding.status = 'unbound' or binding.unbound_at is not null or binding.blocked_at is not null);
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

  select subjects.customer_id into v_line
  from (
    select binding.customer_uuid as customer_id
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and binding.customer_uuid is not null
      and binding.status = 'active'
      and binding.verified is true
      and binding.confirmed_at is not null
      and binding.bound_at is not null
      and binding.unbound_at is null
      and binding.blocked_at is null
    union
    select member_link.customer_id
    from public.member_line_customer_links member_link
    where member_link.organization_id = v_org
      and member_link.line_subject_hash = v_hash
      and member_link.verified_at is not null
  ) subjects;

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
      'LINE_VERIFIED_SESSION', 'LINE 登入已驗證且兩邊顧客唯一相符',
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
$$;

create or replace function public.decide_member_binding_request(
  p_request_id uuid,
  p_decision text,
  p_auth_user_id uuid
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_role public.staff_role;
  v_staff text;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') = 'service_role'
     or auth.uid() is null
     or p_auth_user_id is distinct from auth.uid()
     or p_decision not in ('APPROVED', 'REJECTED') then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  select request_row.organization_id into v_org
  from public.member_binding_requests request_row
  where request_row.id = p_request_id
    and request_row.status = 'PENDING'
  for update;
  if v_org is null then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  v_role := public.user_org_role(v_org);
  v_staff := public.current_operational_staff_id(v_org);
  if v_staff is null or not public.staff_role_is_managerial(v_role) then
    raise exception '沒有權限建立顧客身分對應';
  end if;
  update public.member_binding_requests
     set status = p_decision,
         reviewed_by_staff_id = v_staff,
         reviewed_by_auth_user_id = auth.uid(),
         reviewed_at = now()
   where id = p_request_id;
  return p_request_id;
end;
$$;

revoke all on function public.enqueue_member_binding_review(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.link_booking_source_from_verified_line(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.decide_member_binding_request(uuid, text, uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.enqueue_member_binding_review(uuid, text, text, text, uuid) from service_role';
    execute 'revoke all on function public.decide_member_binding_request(uuid, text, uuid) from service_role';
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function public.link_booking_source_from_verified_line(text, text, text, uuid) to service_role';
    execute 'grant execute on function public.enqueue_member_binding_review(uuid, text, text, text, uuid) to service_role';
    execute 'grant select on public.member_binding_requests to service_role';
  end if;
end $$;

grant execute on function public.decide_member_binding_request(uuid, text, uuid) to authenticated;
