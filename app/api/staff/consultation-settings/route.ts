import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { DEFAULT_CONSULTATION_FIELDS, type ConsultationField } from "@/lib/consultation-settings";

export const dynamic = "force-dynamic";

function validFields(value: unknown): value is ConsultationField[] {
  return Array.isArray(value) && value.length <= 100 &&
    value.every((field: unknown) => {
      if (!field || typeof field !== "object") return false;
      const f = field as Partial<ConsultationField>;
      return typeof f.id === "string" && f.id.length > 0 && f.id.length <= 100 &&
        typeof f.label === "string" && f.label.trim().length > 0 && f.label.length <= 100 &&
        (f.section === "assessment" || f.section === "professionalNote") &&
        (f.type === "single" || f.type === "multi" || f.type === "text" || f.type === "date" || f.type === "rating") &&
        typeof f.enabled === "boolean" && Array.isArray(f.options) && f.options.length <= 100 &&
        f.options.every((option: unknown) => typeof option === "string" && option.trim().length > 0 && option.length <= 200) &&
        new Set(f.options).size === f.options.length;
    }) && new Set(value.map((f: ConsultationField) => f.id)).size === value.length;
}

async function authorize(organizationId: string, write: boolean) {
  if (!organizationId || organizationId.length > 128) return { error: "無效的店家識別", status: 400 } as const;
  const supabase = await createClient();
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) return { error: "請先登入", status: 401 } as const;
  const admin = createServiceRoleClient();
  if (!admin) return { error: "伺服器尚未設定 Supabase 管理連線", status: 503 } as const;
  const { data: membership, error: membershipError } = await admin
    .from("staff_auth_memberships")
    .select("role")
    .eq("auth_user_id", user.id)
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .in("role", write ? ["OWNER", "MANAGER"] : ["OWNER", "MANAGER", "STAFF", "RECEPTIONIST"])
    .limit(1)
    .maybeSingle();
  if (membershipError) return { error: "權限驗證失敗", status: 500 } as const;
  if (!membership) return { error: "沒有此店家的存取權限", status: 403 } as const;
  return { admin, user } as const;
}

export async function GET(request: NextRequest) {
  const organizationId = request.nextUrl.searchParams.get("organizationId") ?? "";
  const auth = await authorize(organizationId, false);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { data, error } = await auth.admin.from("staff_consultation_settings")
    .select("fields,revision,updated_at").eq("organization_id", organizationId).maybeSingle();
  if (error) return NextResponse.json({ error: "無法讀取雲端諮詢設定" }, { status: 500 });
  return NextResponse.json({ fields: data?.fields ?? DEFAULT_CONSULTATION_FIELDS, revision: data?.revision ?? 0, updatedAt: data?.updated_at ?? null }, { headers: { "Cache-Control": "no-store" } });
}

export async function PUT(request: NextRequest) {
  let body: { organizationId?: unknown; fields?: unknown; revision?: unknown };
  try { body = await request.json(); } catch { return NextResponse.json({ error: "資料格式錯誤" }, { status: 400 }); }
  const organizationId = typeof body.organizationId === "string" ? body.organizationId : "";
  const auth = await authorize(organizationId, true);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!validFields(body.fields) || JSON.stringify(body.fields).length > 60000 ||
    !Number.isSafeInteger(body.revision) || (body.revision as number) < 0) {
    return NextResponse.json({ error: "欄位內容或版本格式錯誤" }, { status: 400 });
  }
  const revision = body.revision as number;
  if (revision === 0) {
    const { error } = await auth.admin.from("staff_consultation_settings").insert({
      organization_id: organizationId, fields: body.fields, updated_by: auth.user.id, revision: 1,
    });
    if (error) return NextResponse.json({ error: error.code === "23505" ? "設定已被其他裝置修改，請重新整理" : "儲存失敗" }, { status: error.code === "23505" ? 409 : 500 });
    return NextResponse.json({ revision: 1 });
  }
  const { data, error } = await auth.admin.from("staff_consultation_settings")
    .update({ fields: body.fields, revision: revision + 1, updated_at: new Date().toISOString(), updated_by: auth.user.id })
    .eq("organization_id", organizationId).eq("revision", revision).select("revision").maybeSingle();
  if (error) return NextResponse.json({ error: "儲存失敗" }, { status: 500 });
  if (!data) return NextResponse.json({ error: "設定已被其他裝置修改，請重新整理" }, { status: 409 });
  return NextResponse.json({ revision: data.revision });
}
