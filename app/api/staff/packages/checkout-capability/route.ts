import { NextResponse } from "next/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { getServerStaffAuthUser } from "@/lib/staff-auth/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const actor = await getServerStaffAuthUser();
  if (!actor) return NextResponse.json({ enabled: false }, { headers: { "Cache-Control": "private, no-store" } });
  const enabled = process.env.BEAUTY_OS_PACKAGE_FINANCE_BRIDGE_ENABLED === "1" &&
    createBeautyOsFinanceClient() !== null;
  return NextResponse.json({ enabled }, { headers: { "Cache-Control": "private, no-store" } });
}
