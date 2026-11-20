const url = process.env.BEAUTY_OS_SUPABASE_URL?.trim().replace(/\/$/, "");
const key = process.env.BEAUTY_OS_SUPABASE_SERVICE_ROLE_KEY?.trim();
if (url !== "https://bfzquejrtgqzzarhkiya.supabase.co" || !key) {
  console.log("[publication-schema] skipped");
  process.exit(0);
}

const response = await fetch(`${url}/rest/v1/`, {
  headers: {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/openapi+json",
  },
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
const description = typeof definition.description === "string" ? definition.description.replace(/\s+/g, " ").slice(0, 500) : "";
if (description) console.log("[publication-schema] table", description);
for (const name of columns) {
  const column = properties[name] ?? {};
  const columnDescription = typeof column.description === "string" ? column.description.replace(/\s+/g, " ").slice(0, 300) : "";
  if (!columnDescription) continue;
  console.log("[publication-schema] column", name, columnDescription);
}
