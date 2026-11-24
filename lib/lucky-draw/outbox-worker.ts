import "server-only";
import {createServiceRoleClient} from "@/lib/supabase/admin";

export type RewardOutcome = {state:"done"|"review"|"pending";code:string};
export type RewardEvent = {transaction_id:string;organization_id:string;revision:number;desired_status:"COMPLETED"|"VOIDED";attempts:number};

// Processor must verify authoritative transaction and current identity;
// finance ledger operations must be idempotent. Never settle payment here.
export async function reconcileRewardOutbox(processEvent:(event:RewardEvent)=>Promise<RewardOutcome>){
 const db=createServiceRoleClient();
 if(!db)throw new Error("BOOKING_CONFIG");
 const rows=await db.from("lucky_draw_booking_outbox")
 .select("transaction_id,organization_id,revision,desired_status,attempts")
 .eq("state","pending").lte("next_attempt_at",new Date().toISOString())
 .order("next_attempt_at",{ascending:true}).limit(20);
 if(rows.error)throw new Error("OUTBOX_READ");
 let processed=0;
 for(const row of rows.data??[]){
  const event=row as RewardEvent;
  let result:RewardOutcome;
  try{result=await processEvent(event);}catch{result={state:"pending",code:"PROCESS_FAILED"};}
  const attempts=event.attempts+1;
  const state=result.state==="pending"&&attempts>=10?"review":result.state;
  const next=new Date(Date.now()+Math.min(3600,30*2**Math.min(attempts,7))*1000).toISOString();
  const saved=await db.from("lucky_draw_booking_outbox").update({
   state,attempts,next_attempt_at:next,updated_at:new Date().toISOString(),
   last_code:result.code,
  }).eq("transaction_id",event.transaction_id).eq("organization_id",event.organization_id)
   .eq("revision",event.revision).eq("attempts",event.attempts).eq("state","pending").select("transaction_id");
  if(saved.error)throw new Error("OUTBOX_UPDATE");
  processed+=saved.data?.length??0;
 }
 return {processed};
}
