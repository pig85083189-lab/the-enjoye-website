/**
 * One-shot trusted Preview arm. Management API project id is required.
 * Never arms Production. Never inserts grant/oneshot. Never calls LINE.
 */
import { readFileSync } from "node:fs";

function confirmTrustedOwnerSelfPreviewTarget(input) {
  const ref = (input.managementProjectId ?? "").trim();
  if (ref !== PREVIEW) return { ok: false, message: "管理端專案識別不是指定 Preview Supabase" };
  if ((input.linkedProjectRef ?? "").trim() && input.linkedProjectRef !== ref) {
    return { ok: false, message: "CLI 連結的專案與管理端 Preview 不一致" };
  }
  let host = null;
  try {
    host = new URL(input.supabaseUrl ?? "").hostname;
  } catch {
    host = null;
  }
  if (host !== `${ref}.supabase.co`) return { ok: false, message: "環境變數 host 與管理端 Preview 專案不一致" };
  if ((input.vercelEnv ?? "").trim() !== "preview") return { ok: false, message: "部署環境不是 Preview" };
  const dbHost = (input.managementDbHost ?? "").trim();
  if (dbHost && dbHost !== `db.${ref}.supabase.co`) return { ok: false, message: "資料庫 host 不是指定 Preview" };
  return { ok: true, ref };
}

const PREVIEW = "bfzquejrtgqzzarhkiya";
const PROD = "knccefcxncglgpmvgqlp";
const token = process.env.SUPABASE_ACCESS_TOKEN;
if (!token) {
  console.error("STOP: missing SUPABASE_ACCESS_TOKEN");
  process.exit(1);
}

const linked = readFileSync("/workspace/supabase/.temp/project-ref", "utf8").trim();
const headers = {
  Authorization: `Bearer ${token}`,
  Accept: "application/json",
};

const detailRes = await fetch(`https://api.supabase.com/v1/projects/${PREVIEW}`, { headers });
const detail = await detailRes.json();
const trusted = confirmTrustedOwnerSelfPreviewTarget({
  managementProjectId: detail.id,
  managementDbHost: `db.${detail.id}.supabase.co`,
  vercelEnv: process.env.VERCEL_ENV,
  supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL,
  linkedProjectRef: linked,
});
console.log("TRUSTED", trusted);
if (!trusted.ok) {
  console.error("STOP: trusted Preview verification failed");
  process.exit(1);
}
if (detail.id === PROD || JSON.stringify(detail).includes(PROD)) {
  console.error("STOP: Production ref in target");
  process.exit(1);
}

async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PREVIEW}/database/query`, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json();
  if (res.status >= 400) throw new Error(JSON.stringify(body).slice(0, 800));
  return body;
}

const before = await sql(`
  select supabase_host, runtime from public.line_owner_self_reminder_runtime_identity
  where id = 'runtime'
`);
console.log("IDENTITY_BEFORE", before);
if (Array.isArray(before) && before.length > 0) {
  const row = before[0];
  if (row.supabase_host === "bfzquejrtgqzzarhkiya.supabase.co" && row.runtime === "preview") {
    console.log("ARM_SKIP_ALREADY_PREVIEW");
    process.exit(0);
  }
  console.error("STOP: identity exists with unexpected values", row);
  process.exit(1);
}

const armed = await sql(`
  select public.arm_line_owner_self_reminder_preview_runtime(
    'bfzquejrtgqzzarhkiya.supabase.co',
    'preview'
  ) as result
`);
console.log("ARM_RESULT", JSON.stringify(armed));
const after = await sql(`
  select id, supabase_host, runtime,
         public.line_owner_self_reminder_preview_runtime_ready() as ready,
         public.line_owner_self_reminder_environment_block() as block
  from public.line_owner_self_reminder_runtime_identity
  where id = 'runtime'
`);
console.log("IDENTITY_AFTER", after);
const counts = await sql(`
  select 'grants' as name, count(*)::int as n from public.line_owner_self_reminder_grants
  union all select 'oneshots', count(*)::int from public.line_owner_self_reminder_oneshots
  union all select 'quota', count(*)::int from public.line_owner_self_reminder_quota_snapshots
`);
console.log("OTHER_COUNTS", counts);
if (!after?.[0] || after[0].ready !== true || after[0].block != null) {
  console.error("STOP: arm result unclear");
  process.exit(1);
}
if (counts.some((row) => row.n !== 0)) {
  console.error("STOP: arm created unexpected rows");
  process.exit(1);
}
console.log("ARM_OK");
