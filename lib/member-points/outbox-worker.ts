import "server-only";
import {createServiceRoleClient} from "@/lib/supabase/admin";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import type {RewardEvent,RewardOutcome} from "@/lib/lucky-draw/outbox-worker";
export async function reconcilePointsOutbox(processEvent:(event:RewardEvent)=>Promise<RewardOutcome>,source:"booking"|"finance"="booking"){
 const db=source==="finance"?createBeautyOsFinanceClient():createServiceRoleClient();
 if(!db)throw new Error("POINTS_CONFIG");
 const table="member_points_outbox";
 const rows=await db.from(table).select("transaction_id,organization_id,revision,desired_status,attempts").eq("state","pending").lte("next_attempt_at",new Date().toISOString()).order("next_attempt_at",{ascending:true}).limit(20);
 if(rows.error)throw new Error("POINTS_OUTBOX_READ");
 let processed=0;
 for(const row of rows.data??[]){
  const event=row as RewardEvent;
  let result:RewardOutcome;
  try{result=await processEvent(event);}catch{result={state:"pending",code:"PROCESS_FAILED"};}
  const attempts=event.attempts+1;
  const state=result.state==="pending"&&attempts>=10?"review":result.state;
  const saved=await db.from(table).update({state,attempts,next_attempt_at:new Date(Date.now()+Math.min(3600,30*2**Math.min(attempts,7))*1000).toISOString(),updated_at:new Date().toISOString(),last_code:result.code}).eq("transaction_id",event.transaction_id).eq("organization_id",event.organization_id).eq("revision",event.revision).eq("attempts",event.attempts).eq("state","pending").select("transaction_id");
  if(saved.error)throw new Error("POINTS_OUTBOX_UPDATE");
  processed+=saved.data?.length??0;
 }
 return {processed};
}
