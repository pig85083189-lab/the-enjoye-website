-- Additive finance-database link for a verified LINE subject.
-- Does not replace save_checkout_draft, settle_checkout_draft, or the
-- managerial confirm function. Does not update ledger, appointment, package,
-- or historical identity rows. A pending review does not grant stored value.
-- Apply on the finance database only after the booking-source migration.
-- Do not apply to production in this phase.
--
-- Read-only production inspection confirmed:
-- booking_source_customer_links.organization_id uuid,
-- confirmed_by_staff_id text, evidence_kind text;
-- stored_value_ledger_entries.organization_id and customer_id uuid;
-- line_customer_bindings.organization_id text and customer_id text;
-- member_line_customer_links.organization_id uuid, RLS enabled, verified_at,
-- and the two unique keys. member_binding_requests is absent.
-- line_customer_bindings.organization_id is compared as text to
-- organizations.app_id. It is never cast to uuid and its type is never changed.
-- A text customer_id is used only when it matches a UUID; any other text is ignored.
-- organizations, evidence values, staff ids, link_origin, customer_uuid,
-- binding lifecycle columns, RLS policy bodies, and ledger constraints other
-- than the two identity types are not confirmed. A mismatch raises before the
-- booking-source rewrites. Apply this file inside one transaction so a later
-- error rolls the whole file back. Do not apply to production in this phase.

create or replace function public.line_binding_resolved_customer_id(p_binding jsonb)
returns uuid
language sql
immutable
as $$
  select case
    when coalesce(p_binding->>'customer_uuid', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (p_binding->>'customer_uuid')::uuid
    when coalesce(p_binding->>'customer_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      then (p_binding->>'customer_id')::uuid
    else null
  end;
$$;

do $$
begin
  if to_regclass('public.organizations') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'organizations'
         and column_name = 'id' and udt_name = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'organizations'
         and column_name = 'app_id' and udt_name = 'text'
     ) then
    raise exception 'organizations.id uuid and app_id text were not confirmed; refusing to rewrite organizations';
  end if;
  if to_regclass('public.line_customer_bindings') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'line_customer_bindings'
         and column_name = 'organization_id' and udt_name = 'text'
     ) then
    raise exception 'line_customer_bindings.organization_id is not text; refusing to rewrite it';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bindings'
      and column_name = 'customer_id' and udt_name <> 'text'
  ) or exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bindings'
      and column_name = 'customer_uuid' and udt_name <> 'uuid'
  ) then
    raise exception 'line_customer_bindings customer identity column has an unexpected type; refusing to rewrite it';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_source_customer_links'
      and column_name = 'organization_id' and udt_name = 'uuid'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_source_customer_links'
      and column_name = 'confirmed_by_staff_id' and udt_name = 'text'
  ) or not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'booking_source_customer_links'
      and column_name = 'evidence_kind' and udt_name = 'text'
  ) then
    raise exception 'booking_source_customer_links identity columns do not match the confirmed types; refusing to rewrite them';
  end if;
  if to_regclass('public.stored_value_ledger_entries') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'stored_value_ledger_entries'
         and column_name = 'organization_id' and udt_name = 'uuid'
     )
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'stored_value_ledger_entries'
         and column_name = 'customer_id' and udt_name = 'uuid'
     ) then
    raise exception 'stored_value_ledger_entries identity columns are not confirmed uuid; refusing to install the write gate';
  end if;
  if to_regclass('public.booking_source_customer_links') is null then
    raise exception 'booking_source_customer_links is absent; refusing to replace constraints';
  end if;
  if exists (
    select 1 from public.booking_source_customer_links
    where evidence_kind not in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD', 'LINE_VERIFIED_SESSION')
  ) then
    raise exception 'booking_source_customer_links has an unrecognized evidence_kind; refusing to replace constraints';
  end if;
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'booking_source_customer_links'
      and column_name = 'link_origin'
  ) then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'booking_source_customer_links'
        and column_name = 'link_origin'
        and udt_name <> 'text'
    ) then
      raise exception 'booking_source_customer_links.link_origin is not text; refusing to rewrite it';
    end if;
    if exists (
      select 1 from public.booking_source_customer_links
      where link_origin is not null
        and link_origin not in ('MANAGER_REVIEW', 'LINE_VERIFIED_SESSION')
    ) then
      raise exception 'booking_source_customer_links.link_origin has an unrecognized value; refusing to replace constraints';
    end if;
  end if;
  if exists (
    select 1 from public.booking_source_customer_links
    where evidence_kind in ('CUSTOMER_PRESENT', 'TRUSTED_MEMBER_RECORD')
      and (
        confirmed_by_staff_id is null
        or not public.is_operational_staff_id(confirmed_by_staff_id)
      )
  ) then
    raise exception 'existing managerial booking source link would violate the staff check; refusing to replace constraints';
  end if;
end $$;

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

do $$
begin
  if to_regclass('public.member_line_customer_links') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_line_customer_links'
      and column_name = 'organization_id' and udt_name <> 'uuid'
  ) then
    raise exception 'member_line_customer_links.organization_id is not uuid; refusing to rewrite it';
  end if;
  if to_regclass('public.member_binding_requests') is not null and exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_binding_requests'
      and column_name = 'organization_id' and udt_name <> 'uuid'
  ) then
    raise exception 'member_binding_requests.organization_id is not uuid; refusing to rewrite it';
  end if;
end $$;

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

do $$
begin
  -- Never drop an existing member-line unique constraint or index.
  -- Production already has both keys. Add the subject key only when it is
  -- absent and no non-null hash is duplicated.
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.member_line_customer_links'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%organization_id%line_subject_hash%'
  ) and not exists (
    select 1
    from pg_index
    where indrelid = 'public.member_line_customer_links'::regclass
      and indisunique
      and pg_get_indexdef(indexrelid) ilike '%organization_id%line_subject_hash%'
  ) then
    if exists (
      select 1
      from public.member_line_customer_links
      where line_subject_hash is not null
      group by organization_id, line_subject_hash
      having count(*) > 1
    ) then
      raise exception 'member_line_customer_links has duplicate subject hashes; refusing to add a unique index';
    end if;
    alter table public.member_line_customer_links
      add constraint member_line_customer_links_org_subject unique (organization_id, line_subject_hash);
  end if;
end $$;

do $$
begin
  if to_regclass('public.member_binding_requests') is null then
    create table public.member_binding_requests (
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
    alter table public.member_binding_requests enable row level security;
    revoke all on public.member_binding_requests from public, anon, authenticated;
  else
    alter table public.member_binding_requests add column if not exists line_subject_hash text;
    alter table public.member_binding_requests add column if not exists source_customer_key text;
    alter table public.member_binding_requests add column if not exists status text default 'PENDING';
    alter table public.member_binding_requests add column if not exists reason_code text;
    alter table public.member_binding_requests add column if not exists requested_by_auth_user_id uuid;
    alter table public.member_binding_requests add column if not exists reviewed_by_staff_id text;
    alter table public.member_binding_requests add column if not exists reviewed_by_auth_user_id uuid;
    alter table public.member_binding_requests add column if not exists reviewed_at timestamptz;
    alter table public.member_binding_requests add column if not exists created_at timestamptz default now();
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'member_binding_requests'
        and column_name = 'id' and udt_name = 'uuid' and column_default is null
    ) then
      alter table public.member_binding_requests alter column id set default gen_random_uuid();
    end if;
  end if;
end $$;

create unique index if not exists member_binding_requests_pending_key
  on public.member_binding_requests (organization_id, source_customer_key, reason_code)
  where status = 'PENDING' and source_customer_key is not null;

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

create or replace function public.current_line_subject_customers(
  p_organization_id uuid,
  p_organization_app_id text,
  p_line_subject_hash text
) returns table (customer_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  with binding_rows as (
    select
      public.line_binding_resolved_customer_id(to_jsonb(binding)) as customer_id,
      binding.status,
      binding.verified,
      binding.confirmed_at,
      binding.bound_at,
      binding.unbound_at,
      binding.blocked_at
    from public.line_customer_bindings binding
    where binding.organization_id = p_organization_app_id
      and binding.line_user_id_hash = p_line_subject_hash
      and public.line_binding_resolved_customer_id(to_jsonb(binding)) is not null
  ), revoked as (
    select customer_id, max(coalesce(unbound_at, blocked_at, '-infinity'::timestamptz)) as revoked_at
    from binding_rows
    where status = 'unbound' or unbound_at is not null or blocked_at is not null
    group by customer_id
  ), active as (
    select customer_id, max(bound_at) as bound_at
    from binding_rows
    where status = 'active'
      and verified is true
      and confirmed_at is not null
      and bound_at is not null
      and unbound_at is null
      and blocked_at is null
    group by customer_id
  )
  select active.customer_id
  from active
  left join revoked on revoked.customer_id = active.customer_id
  where revoked.customer_id is null or active.bound_at > revoked.revoked_at
  union
  select member_link.customer_id
  from public.member_line_customer_links member_link
  where member_link.organization_id = p_organization_id
    and member_link.line_subject_hash = p_line_subject_hash
    and member_link.verified_at is not null
    and not exists (
      select 1
      from revoked
      where revoked.customer_id = member_link.customer_id
        and not exists (
          select 1 from active
          where active.customer_id = member_link.customer_id
            and active.bound_at > revoked.revoked_at
        )
    );
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
    select public.line_binding_resolved_customer_id(to_jsonb(binding)) as customer_id
    from public.line_customer_bindings binding
    where binding.organization_id = v_org_app
      and binding.line_user_id_hash = v_hash
      and public.line_binding_resolved_customer_id(to_jsonb(binding)) is not null
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
          and public.line_binding_resolved_customer_id(to_jsonb(active_binding))
            = public.line_binding_resolved_customer_id(to_jsonb(binding))
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

create or replace function public.customer_line_membership_is_current(
  p_organization_id uuid,
  p_customer_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with org as (
    select app_id from public.organizations where id = p_organization_id
  ), bindings as (
    select
      lower(btrim(binding.line_user_id_hash)) as hash,
      binding.status,
      binding.verified,
      binding.confirmed_at,
      binding.bound_at,
      binding.unbound_at,
      binding.blocked_at
    from public.line_customer_bindings binding
    join org on org.app_id = binding.organization_id
    where public.line_binding_resolved_customer_id(to_jsonb(binding)) = p_customer_id
      and lower(btrim(binding.line_user_id_hash)) ~ '^[0-9a-f]{64}$'
  ), revoked as (
    select hash, max(coalesce(unbound_at, blocked_at, '-infinity'::timestamptz)) as revoked_at
    from bindings
    where status = 'unbound' or unbound_at is not null or blocked_at is not null
    group by hash
  ), active as (
    select hash, max(bound_at) as bound_at
    from bindings
    where status = 'active'
      and verified is true
      and confirmed_at is not null
      and bound_at is not null
      and unbound_at is null
      and blocked_at is null
    group by hash
  ), current_hashes as (
    select active.hash
    from active
    left join revoked on revoked.hash = active.hash
    where revoked.hash is null or active.bound_at > revoked.revoked_at
    union
    select lower(btrim(member_link.line_subject_hash))
    from public.member_line_customer_links member_link
    where member_link.organization_id = p_organization_id
      and member_link.customer_id = p_customer_id
      and member_link.verified_at is not null
      and lower(btrim(member_link.line_subject_hash)) ~ '^[0-9a-f]{64}$'
      and not exists (
        select 1
        from revoked
        where revoked.hash = lower(btrim(member_link.line_subject_hash))
          and not exists (
            select 1 from active
            where active.hash = revoked.hash
              and active.bound_at > revoked.revoked_at
          )
      )
  )
  select
    exists (select 1 from current_hashes)
    or (
      not exists (select 1 from revoked)
      and exists (
        select 1
        from public.member_line_customer_links member_link
        where member_link.organization_id = p_organization_id
          and member_link.customer_id = p_customer_id
          and member_link.verified_at is not null
      )
    );
$$;

create or replace function public.stored_value_ledger_requires_current_line_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.customer_line_membership_is_current(new.organization_id, new.customer_id) then
    raise exception '必須先完成 LINE 會員綁定';
  end if;
  return new;
end;
$$;

do $$
begin
  drop trigger if exists trg_stored_value_ledger_current_line on public.stored_value_ledger_entries;
  create trigger trg_stored_value_ledger_current_line
    before insert on public.stored_value_ledger_entries
    for each row execute function public.stored_value_ledger_requires_current_line_membership();
end $$;

revoke all on function public.line_binding_resolved_customer_id(jsonb) from public, anon, authenticated;
revoke all on function public.customer_line_membership_is_current(uuid, uuid) from public, anon, authenticated;
revoke all on function public.stored_value_ledger_requires_current_line_membership() from public, anon, authenticated;
revoke all on function public.current_line_subject_customers(uuid, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_member_binding_review(uuid, text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.link_booking_source_from_verified_line(text, text, text, uuid) from public, anon, authenticated;
revoke all on function public.decide_member_binding_request(uuid, text, uuid) from public, anon;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'revoke all on function public.current_line_subject_customers(uuid, text, text) from service_role';
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
