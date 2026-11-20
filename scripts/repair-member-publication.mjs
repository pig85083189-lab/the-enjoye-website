import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

const url = process.env.BEAUTY_OS_SUPABASE_URL?.trim().replace(/\/$/, "");
const key = process.env.BEAUTY_OS_SUPABASE_SERVICE_ROLE_KEY?.trim();
if (process.env.VERCEL !== "1" || url !== "https://bfzquejrtgqzzarhkiya.supabase.co" || !key) {
  console.log("[member-publication-repair] skipped");
  process.exit(0);
}

const envNames = Object.keys(process.env)
  .filter((name) => /PASSWORD|POOLER|PGHOST|PGUSER|DATABASE|POSTGRES|DIRECT_URL|ACCESS_TOKEN/i.test(name))
  .sort();
console.log("[member-publication-repair] env", envNames.join(",") || "none");
const functionSql = readFileSync("supabase/review/member_publication_insert_once.sql", "utf8");
const repairSql = readFileSync("supabase/review/member_publication_constraint_repair.sql", "utf8");
const headers = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

function safeMessage(body) {
  const message = typeof body?.message === "string" ? body.message : typeof body?.error === "string" ? body.error : "";
  const first = message.split("\n")[0]?.replace(/\s+/g, " ") ?? "";
  if (/failing row|eyJ/i.test(first)) return "hidden";
  return first.slice(0, 180);
}

async function runSql(statement) {
  const targets = [
    "https://api.supabase.com/v1/projects/bfzquejrtgqzzarhkiya/database/query",
    `${url}/pg/query`,
    `${url}/pg-meta/default/query`,
  ];
  const attempts = [];
  for (const target of targets) {
    const response = await fetch(target, {
      method: "POST",
      headers,
      body: JSON.stringify({ query: statement }),
    });
    let body = null;
    try { body = await response.json(); } catch { body = null; }
    attempts.push(`${new URL(target).pathname} ${response.status} ${safeMessage(body)}`);
    if (response.ok) return { ok: true, attempts };
  }
  return { ok: false, attempts };
}

const replaced = await runSql(functionSql);
console.log("[member-publication-repair] function", replaced.ok ? "applied" : "unavailable", replaced.attempts.join(" | "));
const repaired = replaced.ok ? await runSql(repairSql) : { ok: false, attempts: ["not_attempted"] };
console.log("[member-publication-repair] constraints", repaired.ok ? "applied" : "unavailable", repaired.attempts.join(" | "));

const probeId = "00000000-0000-4000-8000-00000000d141";
const probe = await fetch(`${url}/rest/v1/member_treatment_publications`, {
  method: "POST",
  headers: { ...headers, Prefer: "return=minimal" },
  body: JSON.stringify({
    treatment_id: probeId,
    organization_id: "00000000-0000-4000-8000-00000000d142",
    customer_id: "00000000-0000-4000-8000-00000000d143",
    approved_fields: {
      service_name: "課程",
      photos: [{ photoId: "photo-a-b", side: "left", label: "左側", access: "private" }],
    },
    approved_by: "00000000-0000-4000-8000-00000000d144",
    approved_at: "2026-11-20T00:00:00.000Z",
    revoked_at: null,
    updated_at: "2026-11-20T00:00:00.000Z",
  }),
});
let probeBody = null;
try { probeBody = await probe.json(); } catch { probeBody = null; }
const message = typeof probeBody?.message === "string" ? probeBody.message : "";
const details = typeof probeBody?.details === "string" ? probeBody.details : "";
const relation = details.match(/not present in table "([A-Za-z0-9_.]+)"/)?.[1] ?? "";
const constraint = message.match(/constraint "([A-Za-z0-9_]+)"/)?.[1] ?? "";
console.log("[member-publication-repair] probe", probe.status, probeBody?.code ?? "", constraint, relation);
const left = await fetch(`${url}/rest/v1/member_treatment_publications?treatment_id=eq.${probeId}&select=treatment_id`, { headers });
const leftBody = left.ok ? await left.json() : [];
console.log("[member-publication-repair] probe_left", Array.isArray(leftBody) ? leftBody.length : "unreadable");
if (Array.isArray(leftBody) && leftBody.length > 0) {
  const removed = await fetch(`${url}/rest/v1/member_treatment_publications?treatment_id=eq.${probeId}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  });
  console.log("[member-publication-repair] probe_cleanup", removed.status);
}

if (probeBody?.code === "23503" && relation === "member_treatment_mirrors") {
  const backfill = spawnSync(process.execPath, ["scripts/backfill-member-publication.mjs"], { stdio: "inherit" });
  console.log("[member-publication-repair] backfill_exit", backfill.status ?? 1);
} else {
  console.log("[member-publication-repair] backfill_skipped");
}
