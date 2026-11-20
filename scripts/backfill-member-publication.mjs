import { memberPublicationFields } from "../lib/treatments/member-publication-fields.mjs";
import { DEFAULT_CONSULTATION_FIELDS } from "./publication-backfill-defaults.mjs";

const bookingUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim().replace(/\/$/, "");
const bookingKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const financeUrl = process.env.BEAUTY_OS_SUPABASE_URL?.trim().replace(/\/$/, "");
const financeKey = process.env.BEAUTY_OS_SUPABASE_SERVICE_ROLE_KEY?.trim();
const BOOKING_HOST = "knccefcxncglgpmvgqlp.supabase.co";
const FINANCE_HOST = "bfzquejrtgqzzarhkiya.supabase.co";
const treatments = [
  "a00a10f6-c2f8-44df-84e5-27bca6fc9e16",
  "5a968240-9840-4ae1-a26e-dc0563d4aa53",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PHOTO_ID = /^photo-[a-z0-9]+-[a-z0-9]+$/;
const ROLES = new Set(["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"]);

function hostOf(value) {
  try { return new URL(value).host; } catch { return ""; }
}

function report(treatmentId, code) {
  console.log("[member-backfill]", treatmentId, code);
}

async function rest(base, key, path, init = {}) {
  const response = await fetch(`${base}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
  if (!response.ok) return { ok: false, status: response.status, body: null };
  return { ok: true, status: response.status, body: await response.json() };
}

function one(result) {
  return result.ok && Array.isArray(result.body) && result.body.length === 1 ? result.body[0] : null;
}

export function photoRefs(treatmentId, photoMeta) {
  if (!Array.isArray(photoMeta) || photoMeta.length === 0) return { ok: true, photos: [] };
  const photos = [];
  for (const item of photoMeta) {
    const row = item && typeof item === "object" ? item : {};
    if (row.hadPreview !== true) continue;
    if (row.privateObject !== true) return { ok: false };
    const photoId = typeof row.id === "string" ? row.id : "";
    const type = row.type === "AFTER" ? "AFTER" : row.type === "BEFORE" ? "BEFORE" : null;
    if (!type || !UUID.test(treatmentId) || !PHOTO_ID.test(photoId)) return { ok: false };
    const side = type === "BEFORE" ? "left" : "right";
    photos.push({ photoId, side, label: side === "left" ? "左側" : "右側", access: "private" });
  }
  return { ok: true, photos };
}

async function confirmPhotos(treatmentId, photos) {
  for (const photo of photos) {
    const listed = await fetch(`${financeUrl}/storage/v1/object/list/member-treatment-photos`, {
      method: "POST",
      headers: {
        apikey: financeKey,
        Authorization: `Bearer ${financeKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ prefix: treatmentId, limit: 10, search: photo.photoId }),
    });
    if (!listed.ok) return false;
    const files = await listed.json();
    if (!Array.isArray(files) || !files.some((file) => file?.name === photo.photoId)) return false;
  }
  return true;
}

async function backfillOne(treatmentId) {
  const treatmentResult = await rest(bookingUrl, bookingKey, `treatments?id=eq.${treatmentId}&select=id,organization_id,customer_id,appointment_id,service_id,completed_at,status,staff_id,professional_note,assessment,body_markers,body_map_note,discomfort_note,client_feeling,products,follow_up,suggested_tracking_areas,photo_meta`);
  const treatment = one(treatmentResult);
  if (!treatment) return "treatment_missing";
  if (treatment.status !== "COMPLETED" || !treatment.completed_at || !treatment.appointment_id) return "treatment_not_completed";
  const appointment = one(await rest(bookingUrl, bookingKey, `appointments?id=eq.${treatment.appointment_id}&organization_id=eq.${treatment.organization_id}&select=customer_id`));
  if (!appointment || appointment.customer_id !== treatment.customer_id) return "appointment_customer_mismatch";
  const bookingOrg = one(await rest(bookingUrl, bookingKey, `organizations?id=eq.${treatment.organization_id}&select=id,app_id`));
  if (!bookingOrg?.app_id) return "organization_missing";
  const financeOrg = one(await rest(financeUrl, financeKey, `organizations?app_id=eq.${encodeURIComponent(bookingOrg.app_id)}&select=id`));
  if (!financeOrg?.id) return "finance_organization_missing";
  const mirror = one(await rest(financeUrl, financeKey, `member_treatment_mirrors?treatment_id=eq.${treatmentId}&select=organization_id,customer_id,booking_customer_id,status,completed_at`));
  const sameTime = mirror && new Date(mirror.completed_at).getTime() === new Date(treatment.completed_at).getTime();
  if (!mirror || mirror.organization_id !== financeOrg.id || mirror.booking_customer_id !== treatment.customer_id || mirror.status !== "COMPLETED" || !sameTime) {
    return "mirror_mismatch";
  }
  const links = await rest(financeUrl, financeKey, `member_booking_finance_identity_links?select=finance_customer_id,finance_confirmation_id&organization_id=eq.${financeOrg.id}&booking_organization_id=eq.${treatment.organization_id}&booking_customer_id=eq.${treatment.customer_id}&revoked_at=is.null&limit=2`);
  if (!links.ok || !Array.isArray(links.body)) return "line_unverified";
  const evidence = [];
  for (const link of links.body) {
    const confirmation = one(await rest(financeUrl, financeKey, `member_finance_binding_challenges?id=eq.${link.finance_confirmation_id}&organization_id=eq.${financeOrg.id}&confirmed_customer_id=eq.${link.finance_customer_id}&status=eq.CONFIRMED&confirmed_at=not.is.null&select=id`));
    const customer = one(await rest(financeUrl, financeKey, `customers?id=eq.${link.finance_customer_id}&organization_id=eq.${financeOrg.id}&select=id,status`));
    const line = await rest(financeUrl, financeKey, `member_line_customer_links?organization_id=eq.${financeOrg.id}&customer_id=eq.${link.finance_customer_id}&select=verified_at&limit=2`);
    if (!line.ok || !Array.isArray(line.body)) return "line_unverified";
    evidence.push({
      confirmed: Boolean(confirmation),
      active: customer?.status === "ACTIVE" && customer.id === link.finance_customer_id,
      oneLine: line.body.length === 1 && Boolean(line.body[0]?.verified_at),
      customerId: customer?.id ?? "",
    });
  }
  if (evidence.length !== 1 || !evidence[0].confirmed || !evidence[0].active || !evidence[0].oneLine || evidence[0].customerId !== mirror.customer_id) {
    return "line_unverified";
  }
  const staff = await rest(bookingUrl, bookingKey, `staff_auth_memberships?user_id=eq.${encodeURIComponent(treatment.staff_id)}&organization_id=eq.${encodeURIComponent(bookingOrg.app_id)}&is_active=eq.true&select=auth_user_id,user_id,role,is_active,organization_id,display_name`);
  const staffRows = staff.ok && Array.isArray(staff.body) ? staff.body : [];
  const approver = staffRows.length === 1 ? staffRows[0] : null;
  if (!approver || approver.user_id !== treatment.staff_id || approver.organization_id !== bookingOrg.app_id || !ROLES.has(approver.role) || !UUID.test(approver.auth_user_id ?? "") || UUID.test(approver.user_id ?? "")) {
    return "staff_unverified";
  }
  const settings = await rest(bookingUrl, bookingKey, `staff_consultation_settings?organization_id=eq.${encodeURIComponent(bookingOrg.app_id)}&select=fields`);
  if (!settings.ok || !Array.isArray(settings.body) || settings.body.length > 1) return "consultation_unreadable";
  const consultationFields = Array.isArray(settings.body[0]?.fields) ? settings.body[0].fields : DEFAULT_CONSULTATION_FIELDS;
  let serviceName = null;
  if (treatment.service_id) {
    const service = await rest(bookingUrl, bookingKey, `services?id=eq.${treatment.service_id}&organization_id=eq.${treatment.organization_id}&select=name`);
    if (!service.ok || !Array.isArray(service.body) || service.body.length > 1) return "service_unreadable";
    serviceName = typeof service.body[0]?.name === "string" ? service.body[0].name : null;
  }
  const photos = photoRefs(treatmentId, treatment.photo_meta);
  if (!photos.ok) return "photos_unconfirmed";
  if (photos.photos.length && !await confirmPhotos(treatmentId, photos.photos)) return "photos_unconfirmed";
  const fields = {
    ...memberPublicationFields(treatment, consultationFields),
    ...(photos.photos.length ? { photos: photos.photos } : {}),
    ...(serviceName ? { service_name: serviceName } : {}),
    ...(typeof approver.display_name === "string" && approver.display_name.trim() ? { staff_name: approver.display_name.trim() } : {}),
  };
  const rpc = await rest(financeUrl, financeKey, "rpc/insert_member_treatment_publication_once", {
    method: "POST",
    body: JSON.stringify({
      p_treatment_id: treatmentId,
      p_organization_id: financeOrg.id,
      p_customer_id: mirror.customer_id,
      p_approved_fields: fields,
      p_approved_by: approver.auth_user_id,
    }),
  });
  const status = typeof rpc.body === "string" ? rpc.body : "";
  if (!rpc.ok) return "rpc_failed";
  if (status === "unauthorized") return "rpc_unauthorized";
  if (status !== "inserted" && status !== "already") return "rpc_failed";
  const publication = one(await rest(financeUrl, financeKey, `member_treatment_publications?treatment_id=eq.${treatmentId}&select=organization_id,customer_id,revoked_at`));
  if (!publication || publication.revoked_at || publication.organization_id !== financeOrg.id || publication.customer_id !== mirror.customer_id) {
    return "publication_unverified";
  }
  return status === "already" ? "already" : "published";
}

const invokedDirectly = process.argv[1]?.endsWith("backfill-member-publication.mjs");
if (invokedDirectly) {
  if (hostOf(bookingUrl) !== BOOKING_HOST || hostOf(financeUrl) !== FINANCE_HOST || !bookingKey || !financeKey) {
    report("none", "skipped_host");
  } else {
    for (const treatmentId of treatments) {
      let code = "rpc_failed";
      try {
        code = await backfillOne(treatmentId);
      } catch {
        code = "rpc_failed";
      }
      report(treatmentId, code);
      if (code !== "published" && code !== "already") break;
    }
  }
}
