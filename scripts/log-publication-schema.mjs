const url = process.env.BEAUTY_OS_SUPABASE_URL?.trim().replace(/\/$/, "");
const key = process.env.BEAUTY_OS_SUPABASE_SERVICE_ROLE_KEY?.trim();
const envNames = Object.keys(process.env)
  .filter((name) => /DATABASE|POSTGRES|DB_URL|DB_PASSWORD|DIRECT_URL|SUPABASE_ACCESS|SUPABASE_DB/i.test(name))
  .sort();
console.log("[publication-schema] env", envNames.join(",") || "none");

if (url !== "https://bfzquejrtgqzzarhkiya.supabase.co" || !key) {
  console.log("[publication-schema] skipped");
  process.exit(0);
}

const headers = {
  apikey: key,
  Authorization: `Bearer ${key}`,
};

function safeError(body) {
  const message = typeof body?.message === "string" ? body.message : "";
  const details = typeof body?.details === "string" ? body.details : "";
  const hint = typeof body?.hint === "string" ? body.hint : "";
  const constraint = message.match(/constraint "([A-Za-z0-9_]+)"/)?.[1] ?? null;
  const first = message.split("\n")[0]?.replace(/\s+/g, " ").slice(0, 220) ?? "";
  const raised = /failing row/i.test(first) ? null : first;
  const relation = details.match(/not present in table "([A-Za-z0-9_.]+)"/)?.[1]
    ?? details.match(/present in table "([A-Za-z0-9_.]+)"/)?.[1]
    ?? null;
  return {
    code: typeof body?.code === "string" ? body.code : "unknown",
    constraint,
    raised,
    relation,
    hint: hint.replace(/\s+/g, " ").slice(0, 160),
  };
}

const response = await fetch(`${url}/rest/v1/`, {
  headers: { ...headers, Accept: "application/openapi+json" },
});
if (!response.ok) {
  console.log("[publication-schema] openapi_unavailable", response.status);
  process.exit(0);
}
const spec = await response.json();
const definition = spec?.definitions?.member_treatment_publications;
if (!definition || typeof definition !== "object") {
  console.log("[publication-schema] table_absent");
  process.exit(0);
}
const properties = definition.properties && typeof definition.properties === "object" ? definition.properties : {};
const columns = Object.keys(properties).sort();
console.log("[publication-schema] columns", columns.join(","));
console.log("[publication-schema] treatments_table", spec?.definitions?.treatments ? "present" : "absent");
console.log("[publication-schema] mirrors_table", spec?.definitions?.member_treatment_mirrors ? "present" : "absent");
for (const name of columns) {
  const column = properties[name] ?? {};
  const columnDescription = typeof column.description === "string" ? column.description.replace(/\s+/g, " ").slice(0, 300) : "";
  const shape = [column.type, column.format].filter(Boolean).join(":");
  if (columnDescription || shape) console.log("[publication-schema] column", name, shape, columnDescription);
}

const probeId = "00000000-0000-4000-8000-00000000c141";
const probe = await fetch(`${url}/rest/v1/member_treatment_publications`, {
  method: "POST",
  headers: {
    ...headers,
    "Content-Type": "application/json",
    Prefer: "tx=rollback,return=minimal",
  },
  body: JSON.stringify({
    treatment_id: probeId,
    organization_id: "00000000-0000-4000-8000-00000000c142",
    customer_id: "00000000-0000-4000-8000-00000000c143",
    approved_fields: { status: "COMPLETED" },
    approved_by: "00000000-0000-4000-8000-00000000c144",
    approved_at: "2026-11-20T00:00:00.000Z",
    revoked_at: null,
    updated_at: "2026-11-20T00:00:00.000Z",
  }),
});
const applied = probe.headers.get("preference-applied") ?? "";
let probeBody = null;
try { probeBody = await probe.json(); } catch { probeBody = null; }
console.log("[publication-schema] probe", probe.status, applied.includes("rollback") ? "rollback" : "no_rollback", JSON.stringify(safeError(probeBody)));

const left = await fetch(`${url}/rest/v1/member_treatment_publications?treatment_id=eq.${probeId}&select=treatment_id`, { headers });
const leftBody = left.ok ? await left.json() : [];
const leftover = Array.isArray(leftBody) && leftBody.length > 0;
console.log("[publication-schema] probe_left", leftover ? "yes" : "no");
if (leftover) {
  const removed = await fetch(`${url}/rest/v1/member_treatment_publications?treatment_id=eq.${probeId}`, {
    method: "DELETE",
    headers: { ...headers, Prefer: "return=minimal" },
  });
  console.log("[publication-schema] probe_cleanup", removed.status);
}
