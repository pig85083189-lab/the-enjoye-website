import {NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {reconcilePointsOutbox} from "@/lib/member-points/outbox-worker";
import {reconcileBookingPoints} from "@/lib/member-points/reconcile-booking";
import {reconcileFinancePoints} from "@/lib/member-points/reconcile-finance";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const headers={"Cache-Control":"no-store"};
 const secret=process.env.CRON_SECRET;
 const actual=Buffer.from(request.headers.get("authorization")??"");
 const expected=Buffer.from("Bearer "+(secret??""));
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({code:"FORBIDDEN"},{status:403,headers});
 if(process.env.MEMBER_POINTS_ENABLED!=="true")return NextResponse.json({enabled:false},{headers});
 try{
 const booking=await reconcilePointsOutbox(reconcileBookingPoints);
 const finance=await reconcilePointsOutbox(reconcileFinancePoints,"finance");
 return NextResponse.json({booking,finance},{headers});
 }catch{return NextResponse.json({code:"POINTS_RECONCILIATION_FAILED"},{status:503,headers});}
}
