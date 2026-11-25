import "server-only";
import {createServiceRoleClient} from "@/lib/supabase/admin";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {verifyRewardMember} from "@/lib/lucky-draw/reconcile-member";
import {eligibleSpend} from "@/lib/lucky-draw/spend-event";
import type {RewardEvent,RewardOutcome} from "@/lib/lucky-draw/outbox-worker";

export async function reconcileBookingPoints(event:RewardEvent):Promise<RewardOutcome>{
 const booking=createServiceRoleClient(),finance=createBeautyOsFinanceClient();
 if(!booking||!finance)throw new Error("CONFIG");
 const tx=await booking.from("transactions").select("id,status,voided_at,customer_id,total_minor,completed_at,package_redemption,treatment_id").eq("id",event.transaction_id).eq("organization_id",event.organization_id).single();
 if(tx.error||!tx.data)throw new Error("TRANSACTION");
 const t=tx.data;
 if(t.status!==event.desired_status)return {state:"pending",code:"STALE_EVENT"};
 const key="booking:"+event.transaction_id;
 if(event.desired_status==="VOIDED"){
  if(!t.voided_at)return {state:"review",code:"VOID_EVIDENCE_MISSING"};
  const org=await booking.from("organizations").select("app_id").eq("id",event.organization_id).single();
  if(org.error||!org.data?.app_id)throw new Error("BOOKING_ORG");
  const target=await finance.from("organizations").select("id").eq("app_id",org.data.app_id).single();
  if(target.error||!target.data)throw new Error("FINANCE_ORG");
  const result=await finance.rpc("member_points_apply",{p_org:target.data.id,p_customer:null,p_key:key,p_amount:0,p_completed_at:null,p_reverse:true});
  if(result.error)throw new Error("POINTS_REVERSAL");
  const code=String(result.data);
  return {state:["REVERSED","ALREADY_REVERSED","CANCELLED_BEFORE_EARN"].includes(code)?"done":"review",code};
 }
 if(t.voided_at||!t.completed_at)return {state:"review",code:"INVALID_SETTLEMENT"};
 if(t.package_redemption||!t.treatment_id)return {state:"done",code:"NOT_ELIGIBLE"};
 const items=await booking.from("transaction_items").select("type").eq("organization_id",event.organization_id).eq("transaction_id",event.transaction_id).limit(101);
 if(items.error||!items.data||items.data.length>100)throw new Error("ITEMS");
 if(!items.data.length||!items.data.every(i=>i.type==="SERVICE"))return {state:"review",code:"UNSUPPORTED_OR_MIXED_ITEMS"};
 const payments=await booking.from("transaction_payments").select("method,amount_minor").eq("organization_id",event.organization_id).eq("transaction_id",event.transaction_id).limit(101);
 if(payments.error||!payments.data||payments.data.length>100)throw new Error("PAYMENTS");
 const amount=eligibleSpend(Number(t.total_minor),payments.data.map(p=>({method:String(p.method),amount:Number(p.amount_minor)})));
 if(amount!==Number(t.total_minor))return {state:"review",code:"PAYMENT_MISMATCH"};
 const member=await verifyRewardMember(event.organization_id,t.customer_id);
 if(!member)return {state:"review",code:"IDENTITY_UNCONFIRMED"};
 const result=await finance.rpc("member_points_apply",{p_org:member.financeOrg,p_customer:member.financeCustomer,p_key:key,p_amount:amount,p_completed_at:t.completed_at,p_reverse:false});
 if(result.error)throw new Error("POINTS_EARN");
 const code=String(result.data);
 return {state:["EARNED","ALREADY_EARNED","NO_POINTS","DISABLED","CANCELLED"].includes(code)?"done":"review",code};
}
