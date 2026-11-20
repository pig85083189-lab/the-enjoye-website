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

const rpcNames = Object.keys(spec.paths ?? {}).filter((path) => path.includes("/rpc/")).sort();
console.log("[publication-schema] rpc", rpcNames.join(",") || "none");

const keys = [
  "consultation_answers", "professional_note", "body_marker_details", "concerns", "client_focus",
  "comparison_to_last", "sensitivity_level", "body_markers", "body_map_note", "discomfort_note",
  "client_feeling", "products", "follow_up_note", "follow_up_tags", "suggest_next_booking",
  "suggested_date", "suggested_tracking_areas", "photos", "status", "completed_at", "service_name", "staff_name",
];
const samples = {
  consultation_answers: [{ label: "加強部位", value: "肩頸" }],
  professional_note: "note",
  body_marker_details: [{ area: "肩頸", conditions: [], note: null }],
  concerns: ["緊繃"],
  client_focus: "肩頸",
  comparison_to_last: "相同",
  sensitivity_level: 1,
  body_markers: ["肩頸"],
  body_map_note: "note",
  discomfort_note: "note",
  client_feeling: "note",
  products: ["精華"],
  follow_up_note: "note",
  follow_up_tags: ["回訪"],
  suggest_next_booking: false,
  suggested_date: "2026-12-01",
  suggested_tracking_areas: ["肩頸"],
  photos: [{ photoId: "photo-a-b", side: "left", label: "左側", access: "private" }],
  status: "COMPLETED",
  completed_at: "2026-11-20T14:28:45.000Z",
  service_name: "課程",
  staff_name: "美容師",
};
let probeSerial = 1;
async function probeFields(label, fields) {
  const id = `00000000-0000-4000-8000-${String(probeSerial++).padStart(12, "0")}`;
  const result = await fetch(`${url}/rest/v1/member_treatment_publications`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json", Prefer: "tx=rollback,return=minimal" },
    body: JSON.stringify({
      treatment_id: id,
      organization_id: "00000000-0000-4000-8000-00000000c142",
      customer_id: "00000000-0000-4000-8000-00000000c143",
      approved_fields: fields,
      approved_by: "00000000-0000-4000-8000-00000000c144",
      approved_at: "2026-11-20T00:00:00.000Z",
      revoked_at: null,
      updated_at: "2026-11-20T00:00:00.000Z",
    }),
  });
  let body = null;
  try { body = await result.json(); } catch { body = null; }
  const parsed = safeError(body);
  console.log("[publication-schema] key", label, parsed.code, parsed.constraint ?? "", parsed.relation ?? "");
  return id;
}
const probedIds = [];
probedIds.push(await probeFields("empty", {}));
for (const key of keys) probedIds.push(await probeFields(key, { [key]: samples[key] }));
const snapshot = Object.fromEntries(keys.filter((key) => !["photos", "status", "completed_at", "service_name", "staff_name"].includes(key)).map((key) => [key, samples[key]]));
probedIds.push(await probeFields("snapshot", snapshot));
probedIds.push(await probeFields("snapshot_status", { ...snapshot, status: "COMPLETED" }));
const leftIds = `(${probedIds.join(",")})`;
const leftRows = await fetch(`${url}/rest/v1/member_treatment_publications?treatment_id=in.${leftIds}&select=treatment_id`, { headers });
const leftBody = leftRows.ok ? await leftRows.json() : [];
console.log("[publication-schema] key_probe_left", Array.isArray(leftBody) ? leftBody.length : "unreadable");

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
