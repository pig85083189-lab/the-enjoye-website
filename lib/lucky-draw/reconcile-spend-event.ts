import "server-only";
import {createServiceRoleClient} from "@/lib/supabase/admin";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {verifyRewardMember} from "./reconcile-member";
import {eligibleSpend} from "./spend-event";
import type {RewardEvent,RewardOutcome} from "./outbox-worker";

export async function reconcileSpendEvent(event:RewardEvent):Promise<RewardOutcome>{
 const booking=createServiceRoleClient(),finance=createBeautyOsFinanceClient();
 if(!booking||!finance)throw new Error("CONFIG");
 const tx=await booking.from("transactions").select("id,status,voided_at,customer_id,total_minor,completed_at,package_redemption,treatment_id").eq("id",event.transaction_id).eq("organization_id",event.organization_id).single();
 if(tx.error||!tx.data)throw new Error("TRANSACTION");
 if(tx.data.status!==event.desired_status)return {state:"pending",code:"STALE_EVENT"};
 if(event.desired_status==="COMPLETED"){
  const t=tx.data;
  if(t.voided_at||!t.completed_at)return {state:"review",code:"INVALID_SETTLEMENT"};
  if(t.package_redemption||!t.treatment_id)return {state:"done",code:"NOT_ELIGIBLE"};
  const payments=await booking.from("transaction_payments").select("method,amount_minor").eq("organization_id",event.organization_id).eq("transaction_id",event.transaction_id).limit(101);
  if(payments.error||!payments.data||payments.data.length>100)throw new Error("PAYMENTS");
  const amount=eligibleSpend(Number(t.total_minor),payments.data.map(p=>({method:String(p.method),amount:Number(p.amount_minor)})));
  if(!Number.isSafeInteger(Number(t.total_minor))||Number(t.total_minor)<0||amount!==Number(t.total_minor))return {state:"review",code:"PAYMENT_MISMATCH"};
  const member=await verifyRewardMember(event.organization_id,t.customer_id);
  if(!member)return {state:"review",code:"IDENTITY_UNCONFIRMED"};
  const grant=await finance.rpc("lucky_draw_grant_booking_spend",{p_org:member.financeOrg,p_booking_org:event.organization_id,p_booking_customer:t.customer_id,p_transaction:event.transaction_id,p_amount:amount,p_completed_at:t.completed_at,p_verified_hash:member.verifiedHash,p_expected_customer:member.financeCustomer});
  if(grant.error)throw new Error("GRANT");
  return grant.data===null?{state:"review",code:"GRANT_NOT_CONFIRMED"}:{state:"done",code:"GRANTED"};
 }
 if(!tx.data.voided_at)return {state:"review",code:"VOID_EVIDENCE_MISSING"};
 const org=await booking.from("organizations").select("app_id").eq("id",event.organization_id).single();
 if(org.error||!org.data?.app_id)throw new Error("BOOKING_ORG");
 const target=await finance.from("organizations").select("id").eq("app_id",org.data.app_id).single();
 if(target.error||!target.data)throw new Error("FINANCE_ORG");
 const key="booking:"+event.transaction_id;
 const fence=await finance.rpc("lucky_draw_mark_spend_cancelled",{p_org:target.data.id,p_key:key});
 if(fence.error)throw new Error("CANCELLATION_FENCE");
 const entries=await finance.from("lucky_draw_chance_entries").select("campaign_id").eq("organization_id",target.data.id).eq("source","spend").eq("source_key",key).limit(101);
 if(entries.error||!entries.data||entries.data.length>100)throw new Error("LEDGER");
 for(const entry of entries.data){
  const result=await finance.rpc("lucky_draw_reverse_spend",{p_org:target.data.id,p_campaign:entry.campaign_id,p_source_key:key});
  if(result.error)throw new Error("REVERSAL");
  if(result.data==="REVIEW_INSUFFICIENT_BALANCE")return {state:"review",code:"INSUFFICIENT_BALANCE"};
  if(result.data!=="REVERSED"&&result.data!=="ALREADY_REVERSED")return {state:"pending",code:"REVERSAL_UNCONFIRMED"};
 }
 return {state:"done",code:entries.data.length?"REVERSED":"CANCELLED_BEFORE_GRANT"};
}
