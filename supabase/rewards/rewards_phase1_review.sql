-- THE ENJOYE rewards phase 1: REVIEW ONLY.
-- Do not execute until customer identity binding, tenant scope, and authorization are verified.
-- This migration intentionally creates no public API policies and no issue/spend RPC.
begin;
create schema if not exists rewards_private;
revoke all on schema rewards_private from public, anon, authenticated;
create table if not exists rewards_private.programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  coins_per_twd numeric(14,6),
  max_redeem_percent numeric(5,2),
  created_at timestamptz not null default now(),
  check (coins_per_twd is null or coins_per_twd > 0),
  check (max_redeem_percent is null or (max_redeem_percent between 0 and 100))
);
create table if not exists rewards_private.wallets (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references rewards_private.programs(id),
  customer_id uuid not null,
  balance bigint not null default 0 check (balance >= 0),
  version bigint not null default 0,
  created_at timestamptz not null default now(),
  unique(program_id, customer_id),
  unique(id,program_id)
);
create table if not exists rewards_private.ledger (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references rewards_private.wallets(id),
  program_id uuid not null,
  amount bigint not null check (amount <> 0),
  kind text not null check(kind in ('earn','redeem_checkout','redeem_coupon','redeem_gift','reversal','adjustment')),
  idempotency_key text not null,
  source_type text not null,
  source_id text not null,
  reverses_entry_id uuid references rewards_private.ledger(id),
  created_at timestamptz not null default now(),
  foreign key (wallet_id,program_id) references rewards_private.wallets(id,program_id),
  unique(program_id,idempotency_key)
);
create unique index if not exists rewards_one_reversal_per_entry
  on rewards_private.ledger(reverses_entry_id) where reverses_entry_id is not null;
create table if not exists rewards_private.reward_catalog (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references rewards_private.programs(id),
  kind text not null check (kind in ('coupon','gift')),
  title text not null,
  coin_cost bigint not null check(coin_cost > 0),
  active boolean not null default false,
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  check(valid_until is null or valid_from is null or valid_until > valid_from)
);
create table if not exists rewards_private.redemptions (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references rewards_private.wallets(id),
  catalog_id uuid not null references rewards_private.reward_catalog(id),
  ledger_entry_id uuid not null unique references rewards_private.ledger(id),
  status text not null default 'issued' check(status in ('issued','used','expired','void')),
  issued_at timestamptz not null default now(),
  used_at timestamptz,
  expires_at timestamptz
);
create table if not exists rewards_private.pet_profiles (
  wallet_id uuid primary key references rewards_private.wallets(id),
  pet_code text not null default 'cream_bear',
  pet_name text not null default '奶糖',
  affection bigint not null default 0 check(affection >= 0),
  updated_at timestamptz not null default now()
);
create table if not exists rewards_private.task_claims (
  id uuid primary key default gen_random_uuid(),
  wallet_id uuid not null references rewards_private.wallets(id),
  task_code text not null,
  period_key text not null,
  ledger_entry_id uuid unique references rewards_private.ledger(id),
  created_at timestamptz not null default now(),
  unique(wallet_id,task_code,period_key)
);
alter table rewards_private.programs enable row level security;
alter table rewards_private.wallets enable row level security;
alter table rewards_private.ledger enable row level security;
alter table rewards_private.reward_catalog enable row level security;
alter table rewards_private.redemptions enable row level security;
alter table rewards_private.pet_profiles enable row level security;
alter table rewards_private.task_claims enable row level security;
revoke all on all tables in schema rewards_private from public, anon, authenticated;
-- Intentionally no grants, no RLS policies, no client-accessible functions.
-- Required before activation: verify customer_id type and trusted binding; tenant foreign keys;
-- staff permissions; atomically lock wallet row, check balance, insert ledger and update wallet;
-- validate catalog/program scope; checkout reservation/commit/refund; rate limits; server auth;
-- test concurrent spends, idempotency, duplicate claims, reversals, expiry, and RLS.
commit;
