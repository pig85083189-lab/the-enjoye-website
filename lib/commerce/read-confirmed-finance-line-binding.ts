"use server";
import {getAuthenticatedStaffMembership,getServerStaffAuthUser} from "@/lib/staff-auth/server";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
const APP_ORG="org-the-enjoye";
const FINANCE_ORG="62bd49b6-a4c3-4da1-b53e-4746923685f1";
export async function readConfirmedFinanceLineBinding(customerKey:string,organizationId:string):Promise<"verified"|"not_verified"|"unavailable">{
 if(organizationId!==APP_ORG||typeof customerKey!=="string"||customerKey.length>100)return "unavailable";
 const member=await getAuthenticatedStaffMembership({organizationId:APP_ORG});
 const actor=await getServerStaffAuthUser();
 if(member.status!=="ok"||!member.membership.isActive||!["OWNER","MANAGER"].includes(member.membership.role)||!actor||actor.id!==member.membership.authUserId)return "unavailable";
 const db=createBeautyOsFinanceClient();if(!db)return "unavailable";
 const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerKey);
 const customerQuery=db.from("customers").select("id,status").eq("organization_id",FINANCE_ORG);
 const customer=uuid?await customerQuery.eq("id",customerKey).maybeSingle():await customerQuery.eq("app_id",customerKey).maybeSingle();
 if(customer.error)return "unavailable";
 let financeCustomer=customer.data;
 if(!financeCustomer && uuid){
  // First-party verified LINE booking links do not require manager approval.
  // Fail closed for ambiguous, revoked or non-LINE source links.
  const sources=await db.from("booking_source_customer_links")
   .select("finance_booking_customer_id,evidence_kind,status,revoked_at")
   .eq("organization_id",FINANCE_ORG).eq("source_customer_key",customerKey).limit(3);
  if(sources.error)return "unavailable";
  if(sources.data?.length===1 && sources.data[0].status==="ACTIVE"
    && !sources.data[0].revoked_at && sources.data[0].evidence_kind==="LINE_VERIFIED_SESSION"){
   const financeRow=await db.from("customers").select("id,status")
    .eq("organization_id",FINANCE_ORG)
    .eq("id",sources.data[0].finance_booking_customer_id).maybeSingle();
   if(financeRow.error)return "unavailable";
   financeCustomer=financeRow.data;
  }
 }
 if(!financeCustomer && uuid){
  // A booking customer has a different UUID from its finance customer.
  // Only the server-approved, non-revoked identity pair may bridge them.
  const pairs=await db.from("member_booking_finance_identity_links")
   .select("finance_customer_id,finance_confirmation_id")
   .eq("organization_id",FINANCE_ORG).eq("booking_customer_id",customerKey)
   .is("revoked_at",null).limit(2);
  if(pairs.error)return "unavailable";
  if(pairs.data?.length===1){
   const financeRow=await db.from("customers").select("id,status")
    .eq("organization_id",FINANCE_ORG).eq("id",pairs.data[0].finance_customer_id).maybeSingle();
   if(financeRow.error)return "unavailable";
   const confirmation=await db.from("member_finance_binding_challenges")
    .select("id").eq("id",pairs.data[0].finance_confirmation_id)
    .eq("organization_id",FINANCE_ORG)
    .eq("confirmed_customer_id",pairs.data[0].finance_customer_id)
    .eq("status","CONFIRMED").not("confirmed_at","is",null).maybeSingle();
   if(confirmation.error)return "unavailable";
   if(confirmation.data)financeCustomer=financeRow.data;
  }
 }
 if(!financeCustomer||financeCustomer.status!=="ACTIVE")return "not_verified";
 const links=await db.from("member_line_customer_links").select("line_subject_hash,verified_at").eq("organization_id",FINANCE_ORG).eq("customer_id",financeCustomer.id).limit(2);
 if(links.error)return "unavailable";
 if(links.data?.length!==1||!links.data[0].verified_at)return "not_verified";
 const hash=links.data[0].line_subject_hash;
 const confirmations=await db.from("member_finance_binding_challenges").select("confirmed_at").eq("organization_id",FINANCE_ORG).eq("line_subject_hash",hash).eq("confirmed_customer_id",financeCustomer.id).eq("status","CONFIRMED").not("confirmed_at","is",null).order("confirmed_at",{ascending:false}).limit(1);
 const legacy=await db.from("line_customer_bindings").select("status,verified,bound_at,unbound_at,blocked_at").eq("line_user_id_hash",hash).limit(20);
 if(confirmations.error||legacy.error)return "unavailable";
 const proof=confirmations.data?.[0]?.confirmed_at;
 if(!proof){
  // Auto-verified LINE login + unique booking source link is sufficient.
  // Manual challenges remain a fallback for older customer identities.
  if(!uuid)return "not_verified";
  const sources=await db.from("booking_source_customer_links")
   .select("finance_booking_customer_id,evidence_kind,status,revoked_at")
   .eq("organization_id",FINANCE_ORG).eq("source_customer_key",customerKey).limit(3);
  if(sources.error)return "unavailable";
  if(sources.data?.length!==1 || sources.data[0].status!=="ACTIVE"
     || sources.data[0].revoked_at || sources.data[0].evidence_kind!=="LINE_VERIFIED_SESSION"
     || sources.data[0].finance_booking_customer_id!==financeCustomer.id)return "not_verified";
  const [current,owners]=await Promise.all([
   db.rpc("customer_line_membership_is_current",{p_organization_id:FINANCE_ORG,p_customer_id:financeCustomer.id}),
   db.rpc("current_line_subject_customers",{p_organization_id:FINANCE_ORG,p_organization_app_id:APP_ORG,p_line_subject_hash:hash})
  ]);
  if(current.error||owners.error)return "unavailable";
  if(current.data!==true || !Array.isArray(owners.data) || owners.data.length!==1
     || owners.data[0]?.customer_id!==financeCustomer.id)return "not_verified";
  if(legacy.data?.some(row=>row.blocked_at || (row.unbound_at && (!row.bound_at || Date.parse(row.unbound_at)>=Date.parse(row.bound_at)))))return "not_verified";
  return "verified";
 }
 const proofTime=Date.parse(proof);
 if(!Number.isFinite(proofTime))return "not_verified";
 if(legacy.data?.some(row=>{
  if(row.blocked_at)return true;
  if(!row.unbound_at||!row.bound_at||Date.parse(row.unbound_at)<=Date.parse(row.bound_at))return true;
  return Date.parse(row.unbound_at)>=proofTime;
 }))return "not_verified";
 return "verified";
}
