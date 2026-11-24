import {NextResponse} from "next/server";
import {timingSafeEqual} from "node:crypto";
import {reconcileRewardOutbox} from "@/lib/lucky-draw/outbox-worker";
import {reconcileSpendEvent} from "@/lib/lucky-draw/reconcile-spend-event";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
 const headers={"Cache-Control":"no-store"};
 const secret=process.env.CRON_SECRET;
 const actual=Buffer.from(request.headers.get("authorization")??"");
 const expected=Buffer.from("Bearer "+(secret??""));
 if(!secret||actual.length!==expected.length||!timingSafeEqual(actual,expected))return NextResponse.json({code:"FORBIDDEN"},{status:403,headers});
 if(process.env.LUCKY_DRAW_SPEND_ENABLED!=="true")return NextResponse.json({enabled:false},{headers});
 try{return NextResponse.json(await reconcileRewardOutbox(reconcileSpendEvent),{headers});}
 catch{return NextResponse.json({code:"RECONCILIATION_FAILED"},{status:503,headers});}
}
