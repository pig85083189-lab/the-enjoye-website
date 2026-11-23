import { NextRequest, NextResponse } from "next/server";
import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { canCheckout } from "@/lib/staff-auth/operational-capabilities";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const body: unknown = await request.json().catch(() => null);
  if (!body || typeof body !== "object" || Array.isArray(body)) return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
  const input = body as Record<string,unknown>;
  if (typeof input.organizationId !== "string" || !Array.isArray(input.appointmentIds) ||
      input.appointmentIds.length > 100 || !input.appointmentIds.every(x=>typeof x==="string" && /^apt-[A-Za-z0-9_-]{5,100}$/.test(x)))
    return NextResponse.json({error:"INVALID_REQUEST"},{status:400});
  const auth = await getAuthenticatedStaffMembership({organizationId:input.organizationId});
  if (auth.status !== "authenticated" || !auth.membership || !canCheckout(auth.membership))
    return NextResponse.json({error:"FORBIDDEN"},{status:403});
  const db = createBeautyOsFinanceClient();
  if (!db) return NextResponse.json({error:"UNAVAILABLE"},{status:503});
  const {data:orgs,error:orgError} = await db.from("organizations").select("id").eq("app_id",input.organizationId).limit(1);
  if (orgError || orgs?.length !== 1) return NextResponse.json({error:"UNAVAILABLE"},{status:503});
  const ids = [...new Set(input.appointmentIds as string[])];
  if (!ids.length) return NextResponse.json({settled:[]},{headers:{"Cache-Control":"no-store"}});
  const {data:links,error:linkError} = await db.from("package_redemption_booking_links")
    .select("booking_appointment_app_id,transaction_id,transactions!inner(app_id,status)")
    .eq("organization_id",orgs[0]!.id)
    .eq("transactions.status","COMPLETED")
    .in("booking_appointment_app_id",ids);
  if (linkError) return NextResponse.json({error:"UNAVAILABLE"},{status:503});
  const settled = (links ?? []).flatMap(row => {
    const tx = row.transactions as unknown as {app_id:string;status:string}|null;
    return tx?.status === "COMPLETED" ? [{appointmentId:row.booking_appointment_app_id,transactionId:tx.app_id}] : [];
  });
  return NextResponse.json({settled},{headers:{"Cache-Control":"no-store"}});
}
