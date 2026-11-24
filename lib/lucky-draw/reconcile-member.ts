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
  const [customer,canonical,legacyA,legacyB]=await Promise.all([
   db!.from("customers").select("status").eq("organization_id",orgId).eq("id",customerId).maybeSingle(),
   db!.from("member_line_customer_links").select("line_subject_hash,verified_at").eq("organization_id",orgId).eq("customer_id",customerId).limit(101),
   db!.from("line_customer_bindings").select("line_user_id_hash,status,verified,confirmed_at,bound_at,unbound_at").eq("organization_id",app).eq("customer_id",customerId).limit(101),
   db!.from("line_customer_bindings").select("line_user_id_hash,status,verified,confirmed_at,bound_at,unbound_at").eq("organization_id",app).eq("customer_uuid",customerId).limit(101),
  ]);
  if([customer,canonical,legacyA,legacyB].some(x=>x.error)||[canonical,legacyA,legacyB].some(x=>(x.data?.length??0)>100))throw new Error("IDENTITY_QUERY");
  const bindings:VerifiedLineBinding[]=[
   ...(canonical.data??[]).map(x=>({source:"member_link" as const,hash:x.line_subject_hash,verified:!!x.verified_at,status:"active",confirmedAt:x.verified_at,boundAt:x.verified_at,unboundAt:null,blockedAt:null})),
   ...[...(legacyA.data??[]),...(legacyB.data??[])].map(x=>({source:"binding" as const,hash:x.line_user_id_hash,verified:x.verified===true,status:x.status,confirmedAt:x.confirmed_at,boundAt:x.bound_at,unboundAt:x.unbound_at,blockedAt:null})),
  ];
  return decideVerifiedLineSubject({organizationAppId:app,customerOrganizationAppId:customer.data?app:null,customerStatus:customer.data?.status??null,bindings});
 }
 const source=await subject(booking,bookingOrg,bookingCustomer);
 if(source.outcome!=="hash")return null;
 const pairs=await finance.from("member_booking_finance_identity_links").select("finance_customer_id,finance_confirmation_id").eq("organization_id",financeOrg).eq("booking_organization_id",bookingOrg).eq("booking_customer_id",bookingCustomer).is("revoked_at",null).limit(2);
 if(pairs.error)throw new Error("PAIR_QUERY");
 if(pairs.data?.length!==1)return null;
 const pair=pairs.data[0];
 const confirmation=await finance.from("member_finance_binding_challenges").select("id").eq("id",pair.finance_confirmation_id).eq("organization_id",financeOrg).eq("confirmed_customer_id",pair.finance_customer_id).eq("status","CONFIRMED").not("confirmed_at","is",null).maybeSingle();
 if(confirmation.error)throw new Error("CONFIRMATION_QUERY");
 if(!confirmation.data)return null;
 const dest=await subject(finance as typeof booking,financeOrg,pair.finance_customer_id);
 if(dest.outcome!=="hash"||dest.hash!==source.hash)return null;
 return {financeOrg,financeCustomer:pair.finance_customer_id};
}
