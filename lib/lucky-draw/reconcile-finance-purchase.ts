import "server-only";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import type {RewardEvent,RewardOutcome} from "./outbox-worker";

// The finance RPC independently verifies completed purchase, tender,
// campaign and current member identity. Never grant from browser amounts.
export async function reconcileFinancePurchase(organizationId:string,transactionId:string):Promise<RewardOutcome>{
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("FINANCE_CONFIG");
 const result=await db.rpc("lucky_draw_grant_finance_purchase",{p_org:organizationId,p_transaction:transactionId});
 if(result.error)throw new Error("FINANCE_PURCHASE_GRANT");
 return result.data===null?{state:"review",code:"PURCHASE_GRANT_NOT_CONFIRMED"}:{state:"done",code:"PURCHASE_GRANT_CONFIRMED"};
}

export async function reconcileFinanceEvent(event:RewardEvent):Promise<RewardOutcome>{
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("FINANCE_CONFIG");
 const tx=await db.from("transactions").select("status,voided_at,completed_at,total_minor").eq("id",event.transaction_id).eq("organization_id",event.organization_id).single();
 if(tx.error||!tx.data)throw new Error("FINANCE_TRANSACTION");
 if(tx.data.status!==event.desired_status)return {state:"pending",code:"STALE_EVENT"};
 if(event.desired_status==="COMPLETED"){
  if(tx.data.voided_at||!tx.data.completed_at)return {state:"review",code:"INVALID_SETTLEMENT"};
  const purchase=await db.from("customer_packages").select("id").eq("organization_id",event.organization_id).eq("purchase_transaction_id",event.transaction_id).limit(1);
  if(purchase.error)throw new Error("PURCHASE_EVIDENCE");
  if(!purchase.data?.length)return {state:"done",code:"NOT_PACKAGE_PURCHASE"};
  return reconcileFinancePurchase(event.organization_id,event.transaction_id);
 }
 if(!tx.data.voided_at)return {state:"review",code:"VOID_EVIDENCE_MISSING"};
 const key="finance:"+event.transaction_id;
 const fence=await db.rpc("lucky_draw_mark_spend_cancelled",{p_org:event.organization_id,p_key:key});
 if(fence.error)throw new Error("CANCELLATION_FENCE");
 const entries=await db.from("lucky_draw_chance_entries").select("campaign_id").eq("organization_id",event.organization_id).eq("source","spend").eq("source_key",key).limit(101);
 if(entries.error||!entries.data||entries.data.length>100)throw new Error("LEDGER");
 for(const entry of entries.data){
  const result=await db.rpc("lucky_draw_reverse_spend",{p_org:event.organization_id,p_campaign:entry.campaign_id,p_source_key:key});
  if(result.error)throw new Error("REVERSAL");
  if(result.data==="REVIEW_INSUFFICIENT_BALANCE")return {state:"review",code:"INSUFFICIENT_BALANCE"};
  if(result.data!=="REVERSED"&&result.data!=="ALREADY_REVERSED")return {state:"pending",code:"REVERSAL_UNCONFIRMED"};
 }
 return {state:"done",code:entries.data.length?"REVERSED":"CANCELLED_BEFORE_GRANT"};
}
