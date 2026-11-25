import "server-only";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {eligibleSpend} from "@/lib/lucky-draw/spend-event";
import type {RewardEvent,RewardOutcome} from "@/lib/lucky-draw/outbox-worker";
export async function reconcileFinancePoints(event:RewardEvent):Promise<RewardOutcome>{
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("FINANCE_CONFIG");
 const tx=await db.from("transactions").select("status,voided_at,completed_at,total_minor,customer_id,package_redemption,treatment_id").eq("id",event.transaction_id).eq("organization_id",event.organization_id).single();
 if(tx.error||!tx.data)throw new Error("FINANCE_TRANSACTION");
 const t=tx.data,key="finance:"+event.transaction_id;
 if(t.status!==event.desired_status)return {state:"pending",code:"STALE_EVENT"};
 if(event.desired_status==="VOIDED"){
  if(!t.voided_at)return {state:"review",code:"VOID_EVIDENCE_MISSING"};
  const r=await db.rpc("member_points_apply",{p_org:event.organization_id,p_customer:null,p_key:key,p_amount:0,p_completed_at:null,p_reverse:true});
  if(r.error)throw new Error("POINTS_REVERSAL");
  const code=String(r.data);
  return {state:["REVERSED","ALREADY_REVERSED","CANCELLED_BEFORE_EARN"].includes(code)?"done":"review",code};
 }
 if(t.voided_at||!t.completed_at)return {state:"review",code:"INVALID_SETTLEMENT"};
 if(t.package_redemption||t.treatment_id)return {state:"done",code:"NOT_ELIGIBLE"};
 const [items,payments]=await Promise.all([
 db.from("transaction_items").select("type,line_total_minor").eq("organization_id",event.organization_id).eq("transaction_id",event.transaction_id).limit(101),
 db.from("transaction_payments").select("method,amount_minor").eq("organization_id",event.organization_id).eq("transaction_id",event.transaction_id).limit(101)]);
 if(items.error||payments.error||!items.data||!payments.data||items.data.length>100||payments.data.length>100)throw new Error("SETTLEMENT_EVIDENCE");
 if(!items.data.length||!items.data.every(i=>["PRODUCT","PACKAGE_PURCHASE"].includes(String(i.type))))return {state:"review",code:"UNSUPPORTED_OR_MIXED_ITEMS"};
 const amount=eligibleSpend(Number(t.total_minor),payments.data.map(p=>({method:String(p.method),amount:Number(p.amount_minor)})));
 if(amount!==Number(t.total_minor))return {state:"review",code:"PAYMENT_MISMATCH"};
 if(items.data.some(i=>i.type==="PACKAGE_PURCHASE")){
 const evidence=await db.from("customer_packages").select("id").eq("organization_id",event.organization_id).eq("customer_id",t.customer_id).eq("purchase_transaction_id",event.transaction_id).limit(1);
 if(evidence.error||!evidence.data?.length)return {state:"review",code:"PACKAGE_EVIDENCE_MISSING"};
 }
 const r=await db.rpc("member_points_apply",{p_org:event.organization_id,p_customer:t.customer_id,p_key:key,p_amount:amount,p_completed_at:t.completed_at,p_reverse:false});
 if(r.error)throw new Error("POINTS_EARN");
 const code=String(r.data);
 return {state:["EARNED","ALREADY_EARNED","NO_POINTS","DISABLED","CANCELLED"].includes(code)?"done":"review",code};
}
