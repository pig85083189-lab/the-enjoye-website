import "server-only";
import {createClient} from "@/lib/supabase/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {readBookingCheckoutSource} from "@/lib/commerce/booking-source-checkout-server";
import {linkVerifiedLineBookingSource} from "@/lib/commerce/line-verified-booking-source-server";
import {getAuthenticatedStaffMembership,getServerStaffAuthUser} from "@/lib/staff-auth/server";
import {canCheckout} from "@/lib/staff-auth/operational-capabilities";
import {eligibleSpend} from "./spend-event";

export async function grantSettledBookingSpend(draftAppId:string):Promise<void>{
 if(process.env.LUCKY_DRAW_SPEND_ENABLED!=="true")return;
 try{
  const source=await readBookingCheckoutSource(draftAppId);
  if(!source)return;
  const identity=await getAuthenticatedStaffMembership({organizationId:source.organizationAppId});
  const actor=await getServerStaffAuthUser();
  if(identity.status!=="ok"||!canCheckout(identity.membership)||!actor||actor.id!==identity.membership.authUserId)return;
  const booking=await createClient();
  const finance=createBeautyOsFinanceClient();
  if(!finance)throw new Error("CONFIG");
  const draft=await booking.from("checkout_drafts").select("id,customer_id").eq("organization_id",source.organizationId).eq("app_id",draftAppId).single();
  if(draft.error||!draft.data)throw new Error("DRAFT");
  const tx=await booking.from("transactions").select("id,customer_id,status,total_minor,completed_at,voided_at,package_redemption").eq("organization_id",source.organizationId).eq("checkout_draft_id",draft.data.id).eq("status","COMPLETED").single();
  if(tx.error||!tx.data)throw new Error("TRANSACTION");
  const t=tx.data;
  if(t.customer_id!==draft.data.customer_id||t.voided_at||t.package_redemption||!t.completed_at)return;
  const payments=await booking.from("transaction_payments").select("method,amount_minor").eq("organization_id",source.organizationId).eq("transaction_id",t.id).limit(101);
  if(payments.error||!payments.data||payments.data.length>100)throw new Error("PAYMENTS");
  const amount=eligibleSpend(Number(t.total_minor),payments.data.map(p=>({method:String(p.method),amount:Number(p.amount_minor)})));
  if(amount<=0||amount!==Number(t.total_minor))return;
  const link=await linkVerifiedLineBookingSource({organizationAppId:source.organizationAppId,sourceCustomerKey:source.sourceCustomerKey,authUserId:actor.id});
  if(link.outcome!=="linked"&&link.outcome!=="already_linked")return;
  const org=await finance.from("organizations").select("id").eq("app_id",source.organizationAppId).single();
  if(org.error||!org.data)throw new Error("ORG");
  const grant=await finance.rpc("lucky_draw_grant_booking_spend",{p_org:org.data.id,p_booking_org:source.organizationId,p_booking_customer:t.customer_id,p_transaction:t.id,p_amount:amount,p_completed_at:t.completed_at});
  if(grant.error)throw new Error("GRANT");
 }catch{
  // Reward failure must never change the successful settlement response.
  console.error("[lucky-draw] booking_spend_pending");
 }
}
