import "server-only";
import {createServiceRoleClient} from "@/lib/supabase/admin";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import type {RewardEvent,RewardOutcome} from "./outbox-worker";

export async function reconcileSpendEvent(event:RewardEvent):Promise<RewardOutcome>{
 const booking=createServiceRoleClient(),finance=createBeautyOsFinanceClient();
 if(!booking||!finance)throw new Error("CONFIG");
 const tx=await booking.from("transactions").select("id,status,voided_at").eq("id",event.transaction_id).eq("organization_id",event.organization_id).single();
 if(tx.error||!tx.data)throw new Error("TRANSACTION");
 if(tx.data.status!==event.desired_status)return {state:"pending",code:"STALE_EVENT"};
 // Completion requires independent current LINE identity verification.
 // Fail closed until the non-interactive identity resolver is installed.
 if(event.desired_status==="COMPLETED")return {state:"pending",code:"GRANT_RESOLVER_REQUIRED"};
 if(!tx.data.voided_at)return {state:"review",code:"VOID_EVIDENCE_MISSING"};
 const org=await booking.from("organizations").select("app_id").eq("id",event.organization_id).single();
 if(org.error||!org.data?.app_id)throw new Error("BOOKING_ORG");
 const target=await finance.from("organizations").select("id").eq("app_id",org.data.app_id).single();
 if(target.error||!target.data)throw new Error("FINANCE_ORG");
 const key="booking:"+event.transaction_id;
 const entries=await finance.from("lucky_draw_chance_entries").select("campaign_id").eq("organization_id",target.data.id).eq("source","spend").eq("source_key",key).limit(101);
 if(entries.error||!entries.data||entries.data.length>100)throw new Error("LEDGER");
 for(const entry of entries.data){
  const result=await finance.rpc("lucky_draw_reverse_spend",{p_org:target.data.id,p_campaign:entry.campaign_id,p_source_key:key});
  if(result.error)throw new Error("REVERSAL");
  if(result.data==="REVIEW_INSUFFICIENT_BALANCE")return {state:"review",code:"INSUFFICIENT_BALANCE"};
  if(result.data!=="REVERSED"&&result.data!=="ALREADY_REVERSED")return {state:"pending",code:"REVERSAL_UNCONFIRMED"};
 }
 // Keep missing grants under review until grant/void cross-database races
 // are closed by a durable finance-side cancellation fence.
 return entries.data.length?{state:"done",code:"REVERSED"}:{state:"review",code:"NO_GRANT_FOUND"};
}
