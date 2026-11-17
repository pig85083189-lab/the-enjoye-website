-- Isolated scheme A registration cases. Local PostgreSQL only.
-- This file never connects to Supabase and never debits stored value.
\set ON_ERROR_STOP on

do $$
begin
  if current_setting('server_version_num')::int < 130000 then
    raise exception 'PostgreSQL 13 or newer is required';
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

begin;

create table public.organizations (
  id uuid primary key,
  name text not null,
  app_id text
);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id),
  full_name text not null,
  phone text,
  birthday date,
  source text,
  status text not null default 'ACTIVE'
);

create table public.member_line_customer_links (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  customer_id uuid not null,
  line_subject_hash text,
  verified_at timestamptz not null default now(),
  unique (organization_id, customer_id)
);

create table public.line_customer_bindings (
  id text primary key,
  organization_id text not null,
  customer_id text not null,
  customer_uuid uuid,
  line_user_id_hash text not null,
  verified boolean not null default false,
  status text not null,
  bound_at timestamptz,
  confirmed_at timestamptz,
  unbound_at timestamptz,
  blocked_at timestamptz
);

create table public.stored_value_ledger_entries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  amount numeric not null,
  note text not null
);

create table public.customer_packages (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null,
  remaining integer not null
);

insert into public.organizations (id, name, app_id) values
  ('62bd49b6-a4c3-4da1-b53e-4746923685f1', 'THE ENJOYE', 'org-the-enjoye'),
  ('11111111-1111-4111-8111-111111111111', 'Other', 'org-other');

insert into public.customers (id, organization_id, full_name, phone, birthday, source, status) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', '62bd49b6-a4c3-4da1-b53e-4746923685f1', '陳安心', '+886 912-000-001', '1990-01-15', 'IMPORT', 'ACTIVE'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2', '11111111-1111-4111-8111-111111111111', '陳安心', '0912000001', '1990-01-15', 'IMPORT', 'ACTIVE');

insert into public.stored_value_ledger_entries (customer_id, amount, note) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 500, 'seed');

insert into public.customer_packages (customer_id, remaining) values
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 3);

\ir ../migrations/20261117103000_line_member_customer_link.sql

select set_config('request.jwt.claim.role', 'service_role', false);

do $$
declare
  v_nullable text;
  v_default text;
begin
  select is_nullable, column_default
    into v_nullable, v_default
  from information_schema.columns
  where table_schema = 'public' and table_name = 'member_line_customer_links' and column_name = 'verified_at';
  if v_nullable is distinct from 'YES' or v_default is not null then
    raise exception 'verified_at must be nullable and have no default, got % / %', v_nullable, v_default;
  end if;
  if has_function_privilege('anon', 'public.register_beauty_os_line_customer(uuid,text,text,text,date)', 'execute')
     or has_function_privilege('authenticated', 'public.register_beauty_os_line_customer(uuid,text,text,text,date)', 'execute')
     or not has_function_privilege('service_role', 'public.register_beauty_os_line_customer(uuid,text,text,text,date)', 'execute')
     or has_function_privilege('service_role', 'public.member_line_customer_link_queue_review(uuid,text,text,text)', 'execute')
     or has_function_privilege('anon', 'public.member_line_customer_link_queue_review(uuid,text,text,text)', 'execute') then
    raise exception 'registration execute privileges are wrong';
  end if;
end $$;

savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_customer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_hash text := repeat('a', 64);
  v_result jsonb;
  v_customers int;
  v_verified int;
  v_amount numeric;
  v_remaining int;
begin
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, ' 陳安心 ', '886912000001', '1990-01-15');
  if v_result->>'status' is distinct from 'linked' then
    raise exception 'unique safe link status %', v_result;
  end if;
  select count(*) into v_customers from public.customers where organization_id = v_org;
  select count(*) into v_verified
  from public.member_line_customer_links
  where line_subject_hash = v_hash and verified_at is not null;
  select amount into v_amount from public.stored_value_ledger_entries where customer_id = v_customer;
  select remaining into v_remaining from public.customer_packages where customer_id = v_customer;
  if v_customers <> 1 or v_verified <> 0 or v_amount <> 500 or v_remaining <> 3 then
    raise exception 'unique link changed customers %, verified %, amount %, remaining %', v_customers, v_verified, v_amount, v_remaining;
  end if;
  if not exists (
    select 1 from public.member_line_customer_links
    where organization_id = v_org and customer_id = v_customer and line_subject_hash = v_hash and verified_at is null
  ) then
    raise exception 'unique link did not keep the same customer without wallet verification';
  end if;
  if exists (
    select 1 from public.member_line_customer_links where customer_id = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2'
  ) then
    raise exception 'cross-organization customer was linked';
  end if;
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, '陳安心', '0912000001', '1990-01-15');
  select count(*) into v_customers from public.customers where organization_id = v_org;
  if v_result->>'status' is distinct from 'already_linked' or v_customers <> 1 then
    raise exception 'repeat submit created another customer: % / %', v_result, v_customers;
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_hash text := repeat('b', 64);
  v_result jsonb;
  v_customers int;
  v_links int;
begin
  insert into public.customers (organization_id, full_name, phone, birthday, source, status)
  values (v_org, '陳安心', '0912000099', '1992-03-03', 'IMPORT', 'ACTIVE');
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, '陳安心', '0912000001', '1990-01-15');
  select count(*) into v_customers from public.customers where organization_id = v_org;
  select count(*) into v_links from public.member_line_customer_links where organization_id = v_org;
  if v_result->>'status' is distinct from 'manual_review'
     or v_result->>'reason' is distinct from 'MULTIPLE_CUSTOMERS'
     or v_customers <> 2 or v_links <> 0 then
    raise exception 'duplicate name was linked: % customers % links %', v_result, v_customers, v_links;
  end if;
  if (select count(*) from public.member_binding_requests where status = 'PENDING' and reason_code = 'MULTIPLE_CUSTOMERS') <> 1 then
    raise exception 'duplicate name did not queue one review';
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_hash text := repeat('c', 64);
  v_result jsonb;
  v_links int;
begin
  insert into public.customers (organization_id, full_name, phone, birthday, source, status)
  values (v_org, '陳別的', '0912000001', '1990-01-15', 'IMPORT', 'ACTIVE');
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, '陳安心', '0912-000-001', '1990-01-15');
  select count(*) into v_links from public.member_line_customer_links where organization_id = v_org;
  if v_result->>'status' is distinct from 'manual_review'
     or v_result->>'reason' is distinct from 'MULTIPLE_CUSTOMERS'
     or v_links <> 0 then
    raise exception 'duplicate phone was linked: %', v_result;
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_customer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_first text := repeat('d', 64);
  v_second text := repeat('e', 64);
  v_result jsonb;
  v_links int;
begin
  v_result := public.register_beauty_os_line_customer(v_org, v_first, '陳安心', '0912000001', '1990-01-15');
  if v_result->>'status' is distinct from 'linked' then
    raise exception 'first subject did not link: %', v_result;
  end if;
  v_result := public.register_beauty_os_line_customer(v_org, v_second, '陳安心', '0912000001', '1990-01-15');
  select count(*) into v_links
  from public.member_line_customer_links
  where organization_id = v_org and customer_id = v_customer;
  if v_result->>'status' is distinct from 'manual_review'
     or v_result->>'reason' is distinct from 'LINK_CONFLICT'
     or v_links <> 1 then
    raise exception 'second LINE subject attached to a linked customer: % links %', v_result, v_links;
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_customer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_hash text := repeat('f', 64);
  v_wallet int;
  v_current int;
  v_amount numeric;
begin
  insert into public.member_line_customer_links (organization_id, customer_id, line_subject_hash, verified_at)
  values (v_org, v_customer, v_hash, now());
  insert into public.line_customer_bindings (
    id, organization_id, customer_id, customer_uuid, line_user_id_hash, verified, status, unbound_at
  ) values (
    'lcb-test-unbound', 'org-the-enjoye', v_customer::text, v_customer, v_hash, false, 'unbound', now()
  );
  perform public.register_beauty_os_line_customer(v_org, v_hash, '陳安心', '0912000001', '1990-01-15');
  select count(*) into v_wallet
  from public.member_line_customer_links link_row
  where link_row.line_subject_hash = v_hash
    and link_row.verified_at is not null
    and not exists (
      select 1 from public.line_customer_bindings binding_row
      where binding_row.line_user_id_hash = v_hash
        and (binding_row.unbound_at is not null or binding_row.status in ('unbound', 'blocked'))
    );
  select count(*) into v_current
  from public.line_customer_bindings
  where line_user_id_hash = v_hash and unbound_at is null and status in ('active', 'pending');
  select amount into v_amount from public.stored_value_ledger_entries where customer_id = v_customer;
  if v_wallet <> 0 or v_current <> 0 or v_amount <> 500 then
    raise exception 'unbound subject can still see stored value: wallet % current % amount %', v_wallet, v_current, v_amount;
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_hash text := repeat('1', 64);
  v_result jsonb;
  v_customers int;
  v_verified int;
  v_ledger int;
  v_packages int;
begin
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, '新顧客', '0912333444', '2000-02-02');
  if v_result->>'status' is distinct from 'created' then
    raise exception 'new customer was not created: %', v_result;
  end if;
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, '新顧客', '0912333444', '2000-02-02');
  select count(*) into v_customers from public.customers where organization_id = v_org and full_name = '新顧客';
  select count(*) into v_verified
  from public.member_line_customer_links link_row
  join public.customers customer_row on customer_row.id = link_row.customer_id
  where customer_row.full_name = '新顧客' and link_row.verified_at is not null;
  select count(*) into v_ledger from public.stored_value_ledger_entries;
  select count(*) into v_packages from public.customer_packages;
  if v_result->>'status' is distinct from 'already_linked'
     or v_customers <> 1 or v_verified <> 0 or v_ledger <> 1 or v_packages <> 1 then
    raise exception 'repeat create changed records: % customers % verified % ledger % packages %',
      v_result, v_customers, v_verified, v_ledger, v_packages;
  end if;
  if (select birthday from public.customers where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1') is distinct from date '1990-01-15'
     or (select amount from public.stored_value_ledger_entries) <> 500
     or (select remaining from public.customer_packages) <> 3 then
    raise exception 'existing customer, ledger, or package changed';
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_result jsonb;
  v_birthday date;
  v_links int;
begin
  v_result := public.register_beauty_os_line_customer(v_org, repeat('2', 64), '陳安心', '0912000001', '1999-09-09');
  select birthday into v_birthday from public.customers where id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  select count(*) into v_links from public.member_line_customer_links;
  if v_result->>'reason' is distinct from 'NO_TRUSTED_ASSOCIATION' or v_birthday is distinct from date '1990-01-15' or v_links <> 0 then
    raise exception 'birthday mismatch linked or rewrote the customer: %', v_result;
  end if;
  perform set_config('request.jwt.claim.role', 'anon', true);
  v_result := public.register_beauty_os_line_customer(v_org, repeat('3', 64), '沒有的人', '0912555666', null);
  if v_result->>'status' is distinct from 'invalid_scope' or exists (
    select 1 from public.customers where full_name = '沒有的人'
  ) then
    raise exception 'non-service role wrote a customer: %', v_result;
  end if;
end $$;

rollback to savepoint base;

do $$
declare
  v_org uuid := '62bd49b6-a4c3-4da1-b53e-4746923685f1';
  v_customer uuid := 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  v_hash text := repeat('4', 64);
  v_result jsonb;
begin
  insert into public.line_customer_bindings (
    id, organization_id, customer_id, customer_uuid, line_user_id_hash, verified, status, unbound_at
  ) values (
    'lcb-revoked-create', 'org-the-enjoye', v_customer::text, v_customer, v_hash, false, 'unbound', now()
  );
  v_result := public.register_beauty_os_line_customer(v_org, v_hash, '全新的人', '0912777888', '2001-01-01');
  if v_result->>'status' is distinct from 'manual_review'
     or v_result->>'reason' is distinct from 'LINE_REVOKED'
     or exists (select 1 from public.customers where full_name = '全新的人') then
    raise exception 'revoked LINE subject created a customer: %', v_result;
  end if;
end $$;

rollback to savepoint base;
commit;
