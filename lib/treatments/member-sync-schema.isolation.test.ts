// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const publicationSql = readFileSync("supabase/review/member_publication_insert_once.sql", "utf8");
const mirrorSql = readFileSync("supabase/review/member_treatment_mirrors.sql", "utf8");
const preflightSql = readFileSync("supabase/review/member_sync_preflight.readonly.sql", "utf8");
const rollbackSql = readFileSync("supabase/review/member_sync_rollback.sql", "utf8");

const org = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const member = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const treatment = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const approver = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const fields = { professional_note: "今天以淋巴引流為主", status: "COMPLETED" };

async function emptyDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create role mirror_reader nologin;
    create table public.organizations (id uuid primary key);
    insert into public.organizations (id) values ('${org}');
  `);
  return db;
}

async function readyDatabase() {
  const db = await emptyDatabase();
  await db.exec(`
    create table public.customers (
      id uuid not null,
      organization_id uuid not null references public.organizations (id),
      status text not null,
      primary key (id, organization_id)
    );
    create table public.member_treatment_publications (
      treatment_id uuid primary key,
      organization_id uuid not null,
      customer_id uuid not null,
      approved_fields jsonb not null,
      approved_by text,
      approved_at timestamptz,
      revoked_at timestamptz,
      updated_at timestamptz
    );
    create index member_treatment_publications_scope_idx
      on public.member_treatment_publications (organization_id, customer_id)
      where revoked_at is null;
    alter table public.member_treatment_publications enable row level security;
    insert into public.customers (id, organization_id, status) values
      ('${member}', '${org}', 'ACTIVE'),
      ('${other}', '${org}', 'ACTIVE');
  `);
  await db.exec(publicationSql);
  await db.exec(mirrorSql);
  return db;
}

async function publicationResult(db: PGlite, customerId: string, payload: unknown = fields) {
  const result = await db.query<{ result: string }>(
    `select set_config('request.jwt.claim.role', 'service_role', true),
            public.insert_member_treatment_publication_once($1,$2,$3,$4,$5) as result`,
    [treatment, org, customerId, payload, approver],
  );
  return result.rows[0]?.result;
}

function sqlStatements(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n");
}

describe("isolated finance schema apply", () => {
  it("keeps the live text approver and primary key, and does not rewrite existing records", () => {
    const publication = sqlStatements(publicationSql);
    const mirror = sqlStatements(mirrorSql);
    const rollback = sqlStatements(rollbackSql);
    expect(publication).toContain("approved_by must stay text");
    expect(publication).toContain("p_approved_by text");
    expect(publication).not.toMatch(/create\s+unique\s+index/i);
    expect(publication).not.toMatch(/alter\s+table\s+public\.member_treatment_publications/i);
    for (const script of [publication, mirror]) {
      expect(script).not.toMatch(/\b(delete\s+from|truncate|drop\s+table|update\s+public)\b/i);
      expect(script).not.toMatch(/\b(appointments|wallets|stored_value|treatment_photos)\b/i);
    }
    expect(rollback).toContain("drop table if exists public.member_treatment_mirrors");
    expect(rollback).not.toMatch(/drop\s+index[\s\S]*member_treatment_publications_pkey/i);
    expect(rollback).not.toMatch(/\b(delete\s+from|truncate)\b/i);
  });

  it("applies both review scripts, reloads the schema notice, and passes the read-only preflight", async () => {
    const db = await readyDatabase();
    const preflight = await db.query<Record<string, unknown>>(preflightSql);
    expect(preflight.rows[0]).toMatchObject({
      publications_table_exists: true,
      same_name_index_count: 0,
      publications_unique_exact: 1,
      duplicate_treatment_ids: 0,
      customers_id_org_unique: 1,
      approved_by_type: "text",
      approved_by_udt: "text",
      publications_rls_enabled: true,
      mirror_table_exists: true,
      publication_function_exists: true,
      mirror_rls_enabled: true,
      mirror_anon_select: false,
      mirror_service_insert: true,
      publication_function_anon_execute: false,
      publication_function_service_execute: true,
    });
    expect(String(preflight.rows[0]?.publication_index_definitions)).toContain("member_treatment_publications_pkey");
    expect(String(preflight.rows[0]?.publication_index_definitions)).toContain("(treatment_id)");
    expect(String(preflight.rows[0]?.publication_index_definitions)).not.toContain("member_treatment_publications_treatment_id_key");
    expect(publicationSql).toContain("notify pgrst, 'reload schema'");
    expect(mirrorSql).toContain("notify pgrst, 'reload schema'");
  });

  it("keeps one publication for concurrent writers, a revoke, and a different owner", async () => {
    const db = await readyDatabase();
    expect(await publicationResult(db, member)).toBe("inserted");
    expect(await publicationResult(db, member)).toBe("already");
    const count = await db.query<{ count: number }>(
      "select count(*)::int as count from public.member_treatment_publications where treatment_id = $1",
      [treatment],
    );
    expect(count.rows[0]?.count).toBe(1);

    await db.query(
      "update public.member_treatment_publications set revoked_at = now() where treatment_id = $1",
      [treatment],
    );
    expect(await publicationResult(db, member)).toBe("revoked");
    const revoked = await db.query<{ revoked_at: string | null; customer_id: string }>(
      "select revoked_at, customer_id from public.member_treatment_publications where treatment_id = $1",
      [treatment],
    );
    expect(revoked.rows[0]?.revoked_at).toBeTruthy();
    expect(revoked.rows[0]?.customer_id).toBe(member);

    await db.exec("delete from public.member_treatment_publications");
    expect(await publicationResult(db, member)).toBe("inserted");
    expect(await publicationResult(db, other, { professional_note: "他人的紀錄" })).toBe("mismatch");
    const owner = await db.query<{ customer_id: string; approved_fields: { professional_note?: string } }>(
      "select customer_id, approved_fields from public.member_treatment_publications where treatment_id = $1",
      [treatment],
    );
    expect(owner.rows).toHaveLength(1);
    expect(owner.rows[0]?.customer_id).toBe(member);
    expect(owner.rows[0]?.approved_fields.professional_note).toBe("今天以淋巴引流為主");
  });

  it("does not grant the mirror or the function to anonymous clients", async () => {
    const db = await readyDatabase();
    const privileges = await db.query<Record<string, boolean>>(`
      select
        has_table_privilege('anon', 'public.member_treatment_mirrors', 'select') as anon_select,
        has_table_privilege('authenticated', 'public.member_treatment_mirrors', 'select') as authenticated_select,
        has_table_privilege('service_role', 'public.member_treatment_mirrors', 'select') as service_select,
        has_table_privilege('service_role', 'public.member_treatment_mirrors', 'insert') as service_insert,
        has_table_privilege('service_role', 'public.member_treatment_mirrors', 'update') as service_update,
        has_table_privilege('service_role', 'public.member_treatment_mirrors', 'delete') as service_delete,
        has_function_privilege('anon', 'public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)', 'execute') as anon_execute,
        has_function_privilege('service_role', 'public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)', 'execute') as service_execute,
        (select relrowsecurity from pg_class where relname = 'member_treatment_mirrors') as rls
    `);
    expect(privileges.rows[0]).toEqual({
      anon_select: false,
      authenticated_select: false,
      service_select: true,
      service_insert: true,
      service_update: false,
      service_delete: false,
      anon_execute: false,
      service_execute: true,
      rls: true,
    });
    await db.exec("grant select on public.member_treatment_mirrors to mirror_reader");
    await db.exec("set role mirror_reader");
    const visible = await db.query<{ count: number }>("select count(*)::int as count from public.member_treatment_mirrors");
    expect(visible.rows[0]?.count).toBe(0);
    await db.exec("reset role");
  });

  it("rolls the schema back without dropping customers or publications", async () => {
    const db = await readyDatabase();
    await publicationResult(db, member);
    await db.exec(rollbackSql);
    const left = await db.query<{ publications: number; customers: number; mirror: string | null; fn: string | null }>(`
      select
        (select count(*)::int from public.member_treatment_publications) as publications,
        (select count(*)::int from public.customers) as customers,
        to_regclass('public.member_treatment_mirrors') as mirror,
        to_regprocedure('public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)')::text as fn
    `);
    expect(left.rows[0]).toMatchObject({
      publications: 1,
      customers: 2,
      mirror: null,
      fn: null,
    });
    const kept = await db.query<{ pkey: string | null; approver: string | null; scope: string | null }>(`
      select
        to_regclass('public.member_treatment_publications_pkey') as pkey,
        (select data_type from information_schema.columns
          where table_schema = 'public' and table_name = 'member_treatment_publications' and column_name = 'approved_by') as approver,
        to_regclass('public.member_treatment_publications_scope_idx') as scope
    `);
    expect(kept.rows[0]).toMatchObject({
      pkey: "member_treatment_publications_pkey",
      approver: "text",
      scope: "member_treatment_publications_scope_idx",
    });
  });

  it("refuses to drop a mirror table that already holds a member copy", async () => {
    const db = await readyDatabase();
    await db.query(
      `insert into public.member_treatment_mirrors
        (treatment_id, organization_id, customer_id, booking_customer_id, completed_at)
       values ($1, $2, $3, $4, now())`,
      [treatment, org, member, other],
    );
    await expect(db.exec(rollbackSql)).rejects.toThrow("refusing to drop them");
    const left = await db.query<{ count: number; fn: string | null }>(`
      select
        (select count(*)::int from public.member_treatment_mirrors) as count,
        to_regprocedure('public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)')::text as fn
    `);
    expect(left.rows[0]?.count).toBe(1);
    expect(left.rows[0]?.fn).toBeTruthy();
  });

  it("treats a missing exact index as a count, not as a missing publications table", async () => {
    const db = await emptyDatabase();
    await db.exec(`
      create table public.member_treatment_publications (
        treatment_id uuid not null,
        organization_id uuid not null,
        customer_id uuid not null,
        approved_fields jsonb not null,
        approved_by uuid,
        approved_at timestamptz,
        revoked_at timestamptz,
        updated_at timestamptz
      );
    `);
    const preflight = await db.query<Record<string, unknown>>(preflightSql);
    expect(preflight.rows[0]).toMatchObject({
      publications_table_exists: true,
      same_name_index_count: 0,
      publications_unique_exact: 0,
      duplicate_treatment_ids: 0,
      approved_by_type: "uuid",
      publication_index_definitions: "",
      publications_rls_enabled: false,
      mirror_table_exists: false,
      mirror_rls_enabled: false,
      mirror_anon_select: false,
      publication_function_exists: false,
      publication_function_anon_execute: false,
      publication_function_service_execute: false,
    });
  });

  it("refuses the mirror table when the customer organization key is absent", async () => {
    const db = await emptyDatabase();
    await db.exec(`
      create table public.customers (
        id uuid primary key,
        organization_id uuid not null references public.organizations (id),
        status text not null
      );
    `);
    await expect(db.exec(mirrorSql)).rejects.toThrow("customers(id, organization_id)");
    const table = await db.query<{ mirror: string | null }>("select to_regclass('public.member_treatment_mirrors') as mirror");
    expect(table.rows[0]?.mirror).toBeNull();
  });

  it("rejects a caller that is not the service role, even with a UUID", async () => {
    const db = await readyDatabase();
    const rejected = await db.query<{ result: string }>(
      `select public.insert_member_treatment_publication_once($1,$2,$3,$4,$5) as result`,
      [treatment, org, member, fields, approver],
    );
    expect(rejected.rows[0]?.result).toBe("unauthorized");
    const forged = await db.query<{ result: string }>(
      `select set_config('request.jwt.claim.role', 'service_role', true),
              public.insert_member_treatment_publication_once($1,$2,$3,$4,$5) as result`,
      [treatment, org, member, fields, "staff-001"],
    );
    expect(forged.rows[0]?.result).toBe("unauthorized");
    const count = await db.query<{ count: number }>("select count(*)::int as count from public.member_treatment_publications");
    expect(count.rows[0]?.count).toBe(0);
  });

  it("refuses the publication function when duplicates, a uuid approver column, or no primary key already exist", async () => {
    const duplicates = await emptyDatabase();
    await duplicates.exec(`
      create table public.member_treatment_publications (
        treatment_id uuid not null,
        organization_id uuid not null,
        customer_id uuid not null,
        approved_fields jsonb not null,
        approved_by uuid,
        approved_at timestamptz,
        revoked_at timestamptz,
        updated_at timestamptz
      );
      insert into public.member_treatment_publications
        (treatment_id, organization_id, customer_id, approved_fields)
      values
        ('${treatment}', '${org}', '${member}', '{}'::jsonb),
        ('${treatment}', '${org}', '${other}', '{}'::jsonb);
    `);
    await expect(duplicates.exec(publicationSql)).rejects.toThrow("duplicate treatment_id");

    const uuidApprover = await emptyDatabase();
    await uuidApprover.exec(`
      create table public.member_treatment_publications (
        treatment_id uuid primary key,
        organization_id uuid not null,
        customer_id uuid not null,
        approved_fields jsonb not null,
        approved_by uuid,
        approved_at timestamptz,
        revoked_at timestamptz,
        updated_at timestamptz
      );
    `);
    await expect(uuidApprover.exec(publicationSql)).rejects.toThrow("approved_by must stay text");

    const noPrimaryKey = await emptyDatabase();
    await noPrimaryKey.exec(`
      create table public.member_treatment_publications (
        treatment_id uuid not null,
        organization_id uuid not null,
        customer_id uuid not null,
        approved_fields jsonb not null,
        approved_by text,
        approved_at timestamptz,
        revoked_at timestamptz,
        updated_at timestamptz
      );
    `);
    await expect(noPrimaryKey.exec(publicationSql)).rejects.toThrow("created no index");
  });
});
