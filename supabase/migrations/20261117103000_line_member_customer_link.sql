-- Scheme A LINE member to Beauty OS customer link.
-- Replaces register_beauty_os_line_customer. Does not create a second
-- identity table, does not delete or merge customers, and does not update
-- stored-value ledger rows, balances, appointments, or treatment records.
-- Name and phone only select a candidate. The inserted member link keeps
-- verified_at null, so it cannot satisfy customer_line_membership_is_current
-- or the member wallet reader. An existing verified_at value is left as it is.
-- Do not apply to production until the member app accepts status "linked"
-- and treats an unbound LINE binding as an immediate loss of access.

do $$
begin
  if to_regclass('public.member_line_customer_links') is null then
    raise exception 'member_line_customer_links is not installed; refusing to invent a second link table';
  end if;
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'member_line_customer_links' and column_name = 'verified_at'
  ) then
    raise exception 'member_line_customer_links.verified_at is missing; refusing to add a parallel access flag';
  end if;
  execute 'alter table public.member_line_customer_links alter column verified_at drop not null';
  execute 'alter table public.member_line_customer_links alter column verified_at drop default';
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.member_line_customer_links'::regclass
      and contype = 'u'
      and pg_get_constraintdef(oid) ilike '%organization_id%line_subject_hash%'
  ) and not exists (
    select 1 from pg_index
    where indrelid = 'public.member_line_customer_links'::regclass
      and indisunique
      and pg_get_indexdef(indexrelid) ilike '%organization_id%line_subject_hash%'
  ) then
    if exists (
      select 1 from public.member_line_customer_links
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
      requested_by_auth_user_id uuid,
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
      )
    );
    alter table public.member_binding_requests enable row level security;
    revoke all on public.member_binding_requests from public, anon, authenticated;
  else
    alter table public.member_binding_requests alter column requested_by_auth_user_id drop not null;
  end if;
end $$;

create unique index if not exists member_binding_requests_pending_key
  on public.member_binding_requests (organization_id, source_customer_key, reason_code)
  where status = 'PENDING' and source_customer_key is not null;

create or replace function public.register_beauty_os_line_customer(
  p_organization_id uuid,
  p_line_subject_hash text,
  p_name text,
  p_phone text,
  p_birthday date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hash text := lower(btrim(coalesce(p_line_subject_hash, '')));
  v_name text := regexp_replace(btrim(coalesce(p_name, '')), '[[:space:]]+', ' ', 'g');
  v_digits text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  v_phone text;
  v_org_keys text[] := array[p_organization_id::text];
  v_app_id text;
  v_name_count bigint;
  v_phone_count bigint;
  v_pair_active bigint;
  v_pair_any bigint;
  v_customer_id uuid;
  v_customer_birthday date;
  v_customer_status text;
  v_reason text;
  v_has_customer_uuid boolean := false;
  v_holds_other boolean := false;
  v_held_by_other boolean := false;
  v_revoked boolean := false;
  v_current boolean := false;
begin
  if coalesce(current_setting('request.jwt.claim.role', true), '') is distinct from 'service_role'
     or p_organization_id is distinct from '62bd49b6-a4c3-4da1-b53e-4746923685f1'::uuid then
    return jsonb_build_object('status', 'invalid_scope');
  end if;
  if v_hash !~ '^[0-9a-f]{64}$'
     or char_length(v_name) < 2 or char_length(v_name) > 60
     or v_name ~ '[[:cntrl:]]'
     or p_birthday > current_date then
    return jsonb_build_object('status', 'invalid_profile');
  end if;
  if v_digits ~ '^8869[0-9]{8}$' then
    v_phone := '0' || substring(v_digits from 4);
  else
    v_phone := v_digits;
  end if;
  if v_phone !~ '^09[0-9]{8}$' then
    return jsonb_build_object('status', 'invalid_profile');
  end if;
  if to_regclass('public.customers') is null
     or to_regclass('public.line_customer_bindings') is null
     or not exists (
       select 1 from information_schema.columns
       where table_schema = 'public' and table_name = 'customers'
         and column_name in ('full_name', 'phone', 'birthday', 'organization_id', 'status')
       having count(*) = 5
     ) then
    return jsonb_build_object('status', 'invalid_scope');
  end if;
  perform 1 from public.organizations where id = p_organization_id;
  if not found then
    return jsonb_build_object('status', 'invalid_scope');
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_organization_id::text, 31029));

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'organizations' and column_name = 'app_id'
  ) then
    execute 'select app_id from public.organizations where id = $1'
      into v_app_id using p_organization_id;
    if v_app_id is not null and btrim(v_app_id) <> '' and btrim(v_app_id) <> all (v_org_keys) then
      v_org_keys := v_org_keys || btrim(v_app_id);
    end if;
  end if;

  select customer_row.status::text
    into v_customer_status
  from public.member_line_customer_links link_row
  join public.customers customer_row
    on customer_row.id = link_row.customer_id
   and customer_row.organization_id = link_row.organization_id
  where link_row.organization_id = p_organization_id
    and link_row.line_subject_hash = v_hash
  limit 1;
  if found then
    if v_customer_status = 'ACTIVE' then
      return jsonb_build_object('status', 'already_linked');
    end if;
    v_reason := 'ACCOUNT_DISABLED';
    perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, v_reason);
    return jsonb_build_object('status', 'manual_review', 'reason', v_reason);
  end if;

  select
    count(*) filter (where norm_name = v_name),
    count(*) filter (where norm_phone = v_phone),
    count(*) filter (where norm_name = v_name and norm_phone = v_phone and status_text = 'ACTIVE'),
    count(*) filter (where norm_name = v_name and norm_phone = v_phone)
  into v_name_count, v_phone_count, v_pair_active, v_pair_any
  from (
    select
      regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g') as norm_name,
      case
        when regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') ~ '^8869[0-9]{8}$'
          then '0' || substring(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') from 4)
        else regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      end as norm_phone,
      status::text as status_text
    from public.customers
    where organization_id = p_organization_id
  ) normalized;

  if v_name_count = 0 and v_phone_count = 0 then
    if exists (
      select 1 from public.line_customer_bindings binding_row
      where binding_row.line_user_id_hash = v_hash
        and binding_row.organization_id = any (v_org_keys)
        and binding_row.unbound_at is null
        and binding_row.status in ('active', 'pending')
    ) then
      perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, 'LINK_CONFLICT');
      return jsonb_build_object('status', 'manual_review', 'reason', 'LINK_CONFLICT');
    end if;
    if exists (
      select 1 from public.line_customer_bindings binding_row
      where binding_row.line_user_id_hash = v_hash
        and binding_row.organization_id = any (v_org_keys)
        and (binding_row.unbound_at is not null or binding_row.status in ('unbound', 'blocked'))
    ) then
      perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, 'LINE_REVOKED');
      return jsonb_build_object('status', 'manual_review', 'reason', 'LINE_REVOKED');
    end if;
    begin
      insert into public.customers (organization_id, full_name, phone, birthday, source, status)
      values (p_organization_id, v_name, v_phone, p_birthday, 'LINE_MEMBER', 'ACTIVE')
      returning id into v_customer_id;
      insert into public.member_line_customer_links (
        organization_id, customer_id, line_subject_hash, verified_at
      ) values (
        p_organization_id, v_customer_id, v_hash, null
      );
      return jsonb_build_object('status', 'created');
    exception when unique_violation then
      if exists (
        select 1 from public.member_line_customer_links
        where organization_id = p_organization_id and line_subject_hash = v_hash
      ) then
        return jsonb_build_object('status', 'already_linked');
      end if;
      perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, 'LINK_CONFLICT');
      return jsonb_build_object('status', 'manual_review', 'reason', 'LINK_CONFLICT');
    end;
  end if;

  if v_name_count <> 1 or v_phone_count <> 1 or v_pair_active <> 1 then
    if v_name_count = 1 and v_phone_count = 1 and v_pair_any = 1 and v_pair_active = 0 then
      v_reason := 'ACCOUNT_DISABLED';
    else
      v_reason := 'MULTIPLE_CUSTOMERS';
    end if;
    perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, v_reason);
    return jsonb_build_object('status', 'manual_review', 'reason', v_reason);
  end if;

  select id, birthday
    into v_customer_id, v_customer_birthday
  from public.customers
  where organization_id = p_organization_id
    and status::text = 'ACTIVE'
    and regexp_replace(btrim(full_name), '[[:space:]]+', ' ', 'g') = v_name
    and (
      case
        when regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') ~ '^8869[0-9]{8}$'
          then '0' || substring(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') from 4)
        else regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')
      end
    ) = v_phone;

  v_has_customer_uuid := exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'line_customer_bindings' and column_name = 'customer_uuid'
  );

  if v_has_customer_uuid then
    execute $sql$
      select
        exists (
          select 1 from public.line_customer_bindings binding_row
          where binding_row.line_user_id_hash = $1
            and binding_row.organization_id = any ($2)
            and binding_row.unbound_at is null
            and binding_row.status in ('active', 'pending')
            and binding_row.customer_id is distinct from $3
            and binding_row.customer_uuid is distinct from $4
        ),
        exists (
          select 1 from public.line_customer_bindings binding_row
          where binding_row.line_user_id_hash is distinct from $1
            and binding_row.organization_id = any ($2)
            and binding_row.unbound_at is null
            and binding_row.status in ('active', 'pending')
            and (binding_row.customer_id = $3 or binding_row.customer_uuid = $4)
        ),
        exists (
          select 1 from public.line_customer_bindings binding_row
          where binding_row.line_user_id_hash = $1
            and binding_row.organization_id = any ($2)
            and (binding_row.customer_id = $3 or binding_row.customer_uuid = $4)
            and (binding_row.unbound_at is not null or binding_row.status in ('unbound', 'blocked'))
        ),
        exists (
          select 1 from public.line_customer_bindings binding_row
          where binding_row.line_user_id_hash = $1
            and binding_row.organization_id = any ($2)
            and (binding_row.customer_id = $3 or binding_row.customer_uuid = $4)
            and binding_row.unbound_at is null
            and binding_row.status in ('active', 'pending')
        )
    $sql$
    into v_holds_other, v_held_by_other, v_revoked, v_current
    using v_hash, v_org_keys, v_customer_id::text, v_customer_id;
  else
    select
      exists (
        select 1 from public.line_customer_bindings binding_row
        where binding_row.line_user_id_hash = v_hash
          and binding_row.organization_id = any (v_org_keys)
          and binding_row.unbound_at is null
          and binding_row.status in ('active', 'pending')
          and binding_row.customer_id is distinct from v_customer_id::text
      ),
      exists (
        select 1 from public.line_customer_bindings binding_row
        where binding_row.line_user_id_hash is distinct from v_hash
          and binding_row.organization_id = any (v_org_keys)
          and binding_row.unbound_at is null
          and binding_row.status in ('active', 'pending')
          and binding_row.customer_id = v_customer_id::text
      ),
      exists (
        select 1 from public.line_customer_bindings binding_row
        where binding_row.line_user_id_hash = v_hash
          and binding_row.organization_id = any (v_org_keys)
          and binding_row.customer_id = v_customer_id::text
          and (binding_row.unbound_at is not null or binding_row.status in ('unbound', 'blocked'))
      ),
      exists (
        select 1 from public.line_customer_bindings binding_row
        where binding_row.line_user_id_hash = v_hash
          and binding_row.organization_id = any (v_org_keys)
          and binding_row.customer_id = v_customer_id::text
          and binding_row.unbound_at is null
          and binding_row.status in ('active', 'pending')
      )
    into v_holds_other, v_held_by_other, v_revoked, v_current;
  end if;

  if v_holds_other or v_held_by_other or exists (
    select 1 from public.member_line_customer_links link_row
    where link_row.organization_id = p_organization_id
      and link_row.customer_id = v_customer_id
      and link_row.line_subject_hash is distinct from v_hash
  ) then
    v_reason := 'LINK_CONFLICT';
  elsif v_revoked and not v_current then
    v_reason := 'LINE_REVOKED';
  elsif v_customer_birthday is null or p_birthday is null or v_customer_birthday is distinct from p_birthday then
    v_reason := 'NO_TRUSTED_ASSOCIATION';
  else
    v_reason := null;
  end if;

  if v_reason is not null then
    perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, v_reason);
    return jsonb_build_object('status', 'manual_review', 'reason', v_reason);
  end if;

  begin
    insert into public.member_line_customer_links (
      organization_id, customer_id, line_subject_hash, verified_at
    ) values (
      p_organization_id, v_customer_id, v_hash, null
    );
  exception when unique_violation then
    perform public.member_line_customer_link_queue_review(p_organization_id, v_hash, v_phone, 'LINK_CONFLICT');
    return jsonb_build_object('status', 'manual_review', 'reason', 'LINK_CONFLICT');
  end;
  return jsonb_build_object('status', 'linked');
end;
$$;

create or replace function public.member_line_customer_link_queue_review(
  p_organization_id uuid,
  p_line_subject_hash text,
  p_phone text,
  p_reason_code text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if to_regclass('public.member_binding_requests') is null then
    return;
  end if;
  if p_reason_code not in (
    'LINE_NOT_VERIFIED', 'LINE_REVOKED', 'MULTIPLE_LINE_SUBJECTS', 'MULTIPLE_CUSTOMERS',
    'MULTIPLE_FINANCE_CUSTOMERS', 'ORG_MISMATCH', 'LINK_CONFLICT', 'ACCOUNT_DISABLED',
    'NO_TRUSTED_ASSOCIATION'
  ) then
    return;
  end if;
  begin
    insert into public.member_binding_requests (
      organization_id, line_subject_hash, source_customer_key, status, reason_code, requested_by_auth_user_id
    ) values (
      p_organization_id,
      p_line_subject_hash,
      left(p_phone || ':' || p_line_subject_hash, 120),
      'PENDING',
      p_reason_code,
      null
    )
    on conflict do nothing;
  exception
    when unique_violation then null;
    when not_null_violation then null;
    when foreign_key_violation then null;
    when check_violation then null;
    when undefined_table then null;
    when undefined_column then null;
  end;
end;
$$;

revoke all on function public.register_beauty_os_line_customer(uuid, text, text, text, date) from public, anon, authenticated;
revoke all on function public.member_line_customer_link_queue_review(uuid, text, text, text) from public, anon, authenticated, service_role;
grant execute on function public.register_beauty_os_line_customer(uuid, text, text, text, date) to service_role;
