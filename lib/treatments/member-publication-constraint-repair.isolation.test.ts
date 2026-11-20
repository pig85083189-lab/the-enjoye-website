// @vitest-environment node
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

const publicationSql = readFileSync("supabase/review/member_publication_insert_once.sql", "utf8");
const mirrorSql = readFileSync("supabase/review/member_treatment_mirrors.sql", "utf8");
const repairSql = readFileSync("supabase/review/member_publication_constraint_repair.sql", "utf8");

const org = "62bd49b6-a4c3-4da1-b53e-4746923685f1";
const member = "11111111-1111-4111-8111-111111111111";
const treatment = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const approver = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const allowed = {
  professional_note: "今天以淋巴引流為主",
  service_name: "美胸 SPA",
  staff_name: "美容師",
  photos: [{ photoId: "photo-a-b", side: "left", label: "左側", access: "private" }],
};

async function productionShape() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    create table public.organizations (id uuid primary key);
    insert into public.organizations (id) values ('${org}');
    create table public.customers (
      id uuid not null,
      organization_id uuid not null references public.organizations (id),
      status text not null,
      primary key (id, organization_id)
    );
    insert into public.customers (id, organization_id, status) values ('${member}', '${org}', 'ACTIVE');
    create table public.treatments (id uuid primary key);
    create table public.member_treatment_publications (
      treatment_id uuid primary key references public.treatments (id),
      organization_id uuid not null,
      customer_id uuid not null,
      approved_fields jsonb not null,
      approved_by text,
      approved_at timestamptz,
      revoked_at timestamptz,
      updated_at timestamptz,
      constraint approved_fields_allowlist check (
        jsonb_typeof(approved_fields) = 'object'
        and (approved_fields - array[
          'consultation_answers', 'professional_note', 'body_marker_details', 'concerns', 'client_focus',
          'comparison_to_last', 'sensitivity_level', 'body_markers', 'body_map_note', 'discomfort_note',
          'client_feeling', 'products', 'follow_up_note', 'follow_up_tags', 'suggest_next_booking',
          'suggested_date', 'suggested_tracking_areas', 'staff_name'
        ]::text[]) = '{}'::jsonb
      )
    );
    alter table public.member_treatment_publications enable row level security;
  `);
  await db.exec(mirrorSql);
  await db.exec(publicationSql);
  await db.query(
    `insert into public.member_treatment_mirrors
      (treatment_id, organization_id, customer_id, booking_customer_id, completed_at)
     values ($1, $2, $3, $3, '2026-11-20 14:28:45+00')`,
    [treatment, org, member],
  );
  return db;
}

async function publish(db: PGlite, payload: unknown, claimsRole = "service_role") {
  return db.query<{ result: string }>(
    `select set_config('request.jwt.claim.role', '', true),
            set_config('request.jwt.claims', $1, true),
            public.insert_member_treatment_publication_once($2,$3,$4,$5,$6) as result`,
    [JSON.stringify({ role: claimsRole }), treatment, org, member, payload, approver],
  );
}

describe("member publication constraint repair", () => {
  it("does not delete rows, drop tables, or grant the function to anon", () => {
    expect(repairSql).not.toMatch(/\b(delete\s+from|truncate|drop\s+table|update\s+public)\b/i);
    expect(repairSql).not.toMatch(/grant\s+[^;]*\bto\s+(anon|authenticated)\b/i);
    expect(repairSql).toContain("references public.member_treatment_mirrors (treatment_id)");
    expect(repairSql).toContain("approved_fields_allowlist");
  });

  it("lets one mirror-backed publication through and keeps the old guards", async () => {
    const db = await productionShape();
    await expect(db.query(
      `insert into public.member_treatment_publications
        (treatment_id, organization_id, customer_id, approved_fields, approved_by)
       values ($1, $2, $3, $4, $5)`,
      [treatment, org, member, allowed, approver],
    )).rejects.toThrow(/23503|foreign key|23514|check constraint/i);

    await db.exec(repairSql);
    const inserted = await publish(db, allowed);
    expect(inserted.rows[0]?.result).toBe("inserted");
    const again = await publish(db, allowed);
    expect(again.rows[0]?.result).toBe("already");
    await db.query("update public.member_treatment_publications set revoked_at = now() where treatment_id = $1", [treatment]);
    const revoked = await publish(db, allowed);
    expect(revoked.rows[0]?.result).toBe("revoked");
    const stillRevoked = await db.query<{ revoked: boolean }>(
      "select revoked_at is not null as revoked from public.member_treatment_publications where treatment_id = $1",
      [treatment],
    );
    expect(stillRevoked.rows[0]?.revoked).toBe(true);

    const outsider = await db.query<{ result: string }>(
      `select set_config('request.jwt.claims', '{"role":"authenticated"}', true),
              public.insert_member_treatment_publication_once($1,$2,$3,$4,$5) as result`,
      [treatment, org, member, allowed, approver],
    );
    expect(outsider.rows[0]?.result).toBe("unauthorized");
    await expect(publish(db, { ...allowed, status: "COMPLETED" })).rejects.toThrow(/approved_fields_allowlist|23514/);

    const grants = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`
      select
        has_function_privilege('anon', 'public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)', 'execute') as anon,
        has_function_privilege('authenticated', 'public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)', 'execute') as authenticated,
        has_function_privilege('service_role', 'public.insert_member_treatment_publication_once(uuid,uuid,uuid,jsonb,text)', 'execute') as service
    `);
    expect(grants.rows[0]).toEqual({ anon: false, authenticated: false, service: true });
    const target = await db.query<{ definition: string }>(`
      select pg_get_constraintdef(constraint_row.oid) as definition
      from pg_constraint constraint_row
      where constraint_row.conname = 'member_treatment_publications_treatment_id_fkey'
    `);
    expect(target.rows[0]?.definition).toContain("member_treatment_mirrors");
    const count = await db.query<{ count: number }>("select count(*)::int as count from public.member_treatment_publications");
    expect(count.rows[0]?.count).toBe(1);
  });
});
