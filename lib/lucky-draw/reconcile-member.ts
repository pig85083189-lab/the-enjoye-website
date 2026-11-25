import "server-only";
import {createServiceRoleClient} from "@/lib/supabase/admin";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import {decideVerifiedLineSubject,type VerifiedLineBinding} from "@/lib/commerce/line-verified-booking-source";

export async function verifyRewardMember(bookingOrg:string,bookingCustomer:string){
 const booking=createServiceRoleClient(),finance=createBeautyOsFinanceClient();
 if(!booking||!finance)throw new Error("CONFIG");
 const org=await booking.from("organizations").select("app_id").eq("id",bookingOrg).single();
 if(org.error||!org.data?.app_id)throw new Error("ORG");
 const app=org.data.app_id;
 const target=await finance.from("organizations").select("id").eq("app_id",app).single();
 if(target.error||!target.data)throw new Error("FINANCE_ORG");
 const financeOrg=target.data.id;
 async function subject(db:typeof booking,orgId:string,customerId:string){
  const legacyQuery = () => db === booking
   ? db!.from("line_customer_bindings").select("line_user_id_hash,status,verified,confirmed_at,bound_at,unbound_at")
   : db!.from("line_customer_bindings").select("line_user_id_hash,status,verified,confirmed_at,bound_at,unbound_at,blocked_at");
  const [customer,canonical,legacyA,legacyB]=await Promise.all([
   db!.from("customers").select("status").eq("organization_id",orgId).eq("id",customerId).maybeSingle(),
   db!.from("member_line_customer_links").select("line_subject_hash,verified_at").eq("organization_id",orgId).eq("customer_id",customerId).limit(101),
   legacyQuery().eq("organization_id",app).eq("customer_id",customerId).limit(101),
   legacyQuery().eq("organization_id",app).eq("customer_uuid",customerId).limit(101),
  ]);
  if([customer,canonical,legacyA,legacyB].some(x=>x.error)||[canonical,legacyA,legacyB].some(x=>(x.data?.length??0)>100))throw new Error("IDENTITY_QUERY");
  const bindings:VerifiedLineBinding[]=[
   ...(canonical.data??[]).map(x=>({source:"member_link" as const,hash:x.line_subject_hash,verified:!!x.verified_at,status:"active",confirmedAt:x.verified_at,boundAt:x.verified_at,unboundAt:null,blockedAt:null})),
   ...[...(legacyA.data??[]),...(legacyB.data??[])].map(x=>({source:"binding" as const,hash:x.line_user_id_hash,verified:x.verified===true,status:x.status,confirmedAt:x.confirmed_at,boundAt:x.bound_at,unboundAt:x.unbound_at,blockedAt:(x as unknown as {blocked_at?:string|null}).blocked_at??null})),
  ];
  return decideVerifiedLineSubject({organizationAppId:app,customerOrganizationAppId:customer.data?app:null,customerStatus:customer.data?.status??null,bindings});
 }
 const source=await subject(booking,bookingOrg,bookingCustomer);
 if(source.outcome!=="hash")return null;
 const pairs=await finance.from("member_booking_finance_identity_links").select("finance_customer_id,finance_confirmation_id").eq("organization_id",financeOrg).eq("booking_organization_id",bookingOrg).eq("booking_customer_id",bookingCustomer).is("revoked_at",null).limit(2);
 if(pairs.error)throw new Error("PAIR_QUERY");
 if(pairs.data?.length===0){
  const [history,sourceOwners,destOwners,legacy]=await Promise.all([
   finance.from("member_booking_finance_identity_links").select("id").eq("organization_id",financeOrg).eq("booking_customer_id",bookingCustomer).limit(1),
   booking.from("member_line_customer_links").select("customer_id,verified_at").eq("organization_id",bookingOrg).eq("line_subject_hash",source.hash).limit(2),
   finance.from("member_line_customer_links").select("customer_id,verified_at").eq("organization_id",financeOrg).eq("line_subject_hash",source.hash).limit(2),
   finance.from("line_customer_bindings").select("id").eq("organization_id",app).eq("line_user_id_hash",source.hash).limit(1),
  ]);
  if([history,sourceOwners,destOwners,legacy].some(x=>x.error))throw new Error("FIRST_TIME_QUERY");
  if(history.data?.length!==0||legacy.data?.length!==0||sourceOwners.data?.length!==1||sourceOwners.data[0].customer_id!==bookingCustomer||!sourceOwners.data[0].verified_at||destOwners.data?.length!==1||!destOwners.data[0].verified_at)return null;
  const id=destOwners.data[0].customer_id;
  const [otherPairs,challenges,wallet]=await Promise.all([
   finance.from("member_booking_finance_identity_links").select("id").eq("organization_id",financeOrg).eq("finance_customer_id",id).limit(1),
   finance.from("member_finance_binding_challenges").select("id").eq("organization_id",financeOrg).eq("line_subject_hash",source.hash).limit(1),
   finance.from("customer_wallet_identities").select("id").eq("organization_id",financeOrg).or(`booking_customer_id.eq.${id},wallet_customer_id.eq.${id}`).limit(1),
  ]);
  if([otherPairs,challenges,wallet].some(x=>x.error))throw new Error("FIRST_TIME_CONFLICT_QUERY");
  if([otherPairs,challenges,wallet].some(x=>x.data?.length!==0))return null;
  const dest=await subject(finance as typeof booking,financeOrg,id);
  if(dest.outcome!=="hash"||dest.hash!==source.hash)return null;
  return {financeOrg,financeCustomer:id,verifiedHash:source.hash,firstTime:true as const};
 }
 if(pairs.data?.length!==1)return null;
 const pair=pairs.data[0];
 const confirmation=await finance.from("member_finance_binding_challenges").select("id").eq("id",pair.finance_confirmation_id).eq("organization_id",financeOrg).eq("confirmed_customer_id",pair.finance_customer_id).eq("status","CONFIRMED").not("confirmed_at","is",null).maybeSingle();
 if(confirmation.error)throw new Error("CONFIRMATION_QUERY");
 if(!confirmation.data)return null;
 const dest=await subject(finance as typeof booking,financeOrg,pair.finance_customer_id);
 if(dest.outcome!=="hash"||dest.hash!==source.hash)return null;
 return {financeOrg,financeCustomer:pair.finance_customer_id,verifiedHash:source.hash};
}
