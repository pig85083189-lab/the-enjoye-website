"use server";

import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";
import { DEFAULT_CONSULTATION_FIELDS } from "@/lib/consultation-settings";
import {
  commitAutomaticPublication,
  type ExistingPublication,
} from "@/lib/treatments/member-publication-guard";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import {
  commitMemberTreatmentCopy,
  financeMemberFromEvidence,
  MEMBER_IDENTITY_UNVERIFIED,
  type MirrorRecord,
} from "@/lib/treatments/member-treatment-sync";
import { memberSyncCustomerAllowed } from "@/lib/treatments/member-sync-allowlist";
import { verifiedBookingPublicationApprover } from "@/lib/treatments/publication-approver";
import {
  MEMBER_TREATMENT_PHOTO_BUCKET,
  confirmPrivateTreatmentPhotos,
  privatePhotoRefsFromMeta,
} from "@/lib/treatments/member-photo-storage";
import { assertMemberPublicationTarget } from "@/lib/treatments/publication-database";

const allowedRoles = new Set(["OWNER","MANAGER"]);
type PublicValue = string | string[] | number | boolean | Array<{label:string;value:string}> | Array<{area:string;conditions:string[];note:string|null}>;
type PublicFields = Record<string, PublicValue>;
type Preview = { status:"draft"|"published"; fields:PublicFields; publishedKeys:string[]; approvedConsultationLabels:string[]; completedAt:string };

function str(v:unknown):string|null {return typeof v==="string"&&v.trim()?v.trim().slice(0,500):null;}
function arr(v:unknown):string[]{return Array.isArray(v)?v.map(str).filter((x):x is string=>!!x).slice(0,20):[];}
function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}
function add(target:PublicFields,key:string,value:PublicValue|null) {
 if(value!==null&&(!Array.isArray(value)||value.length>0))target[key]=value;
}
async function context(organizationId:string,treatmentId:string, allowStaff=false){
 if(!organizationId||organizationId.length>160||!treatmentId||treatmentId.length>160)throw Error("無效的療程資料");
 const auth=await getAuthenticatedStaffMembership({organizationId});
 if(auth.status!=="ok"||(!allowedRoles.has(auth.membership.role)&&!(allowStaff&&["STAFF","RECEPTIONIST"].includes(auth.membership.role))))throw Error("沒有權限公開療程");
 const db=createServiceRoleClient();
 if(!db)throw Error("資料庫尚未設定");
 const {data:org,error:orgError}=await db.from("organizations").select("id").eq("app_id",organizationId).maybeSingle();
 if(orgError||!org)throw Error("找不到此店家的正式資料，無法公開");
 const {data:matches,error}=await db.from("treatments").select("id,organization_id,customer_id,service_id,completed_at,status,staff_id,professional_note,assessment,body_markers,body_map_note,discomfort_note,client_feeling,products,follow_up,suggested_tracking_areas,photo_meta")
  .eq("app_id",treatmentId).eq("organization_id",org.id).eq("status","COMPLETED").not("completed_at","is",null).limit(2);
 const t=matches?.length===1?matches[0]:null;
 if(error||!t)throw Error("只有正式資料庫中已完成的療程可以公開");
 const {data:storedPhotos,error:photoError}=await db.from("treatment_photos").select("storage_path,photo_type,sort_order")
  .eq("treatment_id",t.id).eq("organization_id",org.id).order("sort_order").limit(12);
 if(photoError)throw Error("無法確認療程照片，請稍後重試");
 const treatment={...t,treatment_photos:storedPhotos??[]};
 const {data:settings,error:settingsError}=await db.from("staff_consultation_settings").select("fields").eq("organization_id",organizationId).maybeSingle();
 if(settingsError)throw Error("無法讀取諮詢欄位設定，請稍後重試");
 const consultationFields=Array.isArray(settings?.fields)?settings.fields:DEFAULT_CONSULTATION_FIELDS;
 const {data:customer}=await db.from("customers").select("id").eq("id",treatment.customer_id).eq("organization_id",org.id).eq("status","ACTIVE").maybeSingle();
 if(!customer)throw Error("顧客資料無效");
 return {db,t:treatment,auth,org,consultationFields};
}
function makeSnapshot(t:Record<string,unknown>,consultationFields:unknown):PublicFields {
 const a=obj(t.assessment),f=obj(t.follow_up),fields:PublicFields={};
 // Publish only explicitly reviewed data. Labels come from the organization's configured field definitions.
 const answers=obj(a.consultationAnswers);
 const definitions=Array.isArray(consultationFields)?consultationFields:DEFAULT_CONSULTATION_FIELDS;
 const approvedAnswers=definitions.slice(0,30).flatMap((raw:unknown)=>{
  const definition=obj(raw),id=str(definition.id),label=str(definition.label);
  if(!id||!label)return [];
  const rawAnswer=answers[id];
  const value=Array.isArray(rawAnswer)?arr(rawAnswer).join("、"):typeof rawAnswer==="number"||typeof rawAnswer==="boolean"?String(rawAnswer):str(rawAnswer);
  return value?[{label,value}]:[];
 });
 if(approvedAnswers.length)fields.consultation_answers=approvedAnswers;
 // Internal professional notes are opt-in only and must be explicitly approved by a manager.
 add(fields,"professional_note",typeof t.professional_note==="string"&&t.professional_note.trim()?t.professional_note.trim().slice(0,4000):null);
 const markerDetails=Array.isArray(t.body_markers)?t.body_markers.slice(0,40).flatMap((raw:unknown)=>{
  const marker=obj(raw),area=str(marker.area);
  return area?[{area,conditions:arr(marker.conditions),note:str(marker.note)}]:[];
 }):[];
 if(markerDetails.length)fields.body_marker_details=markerDetails;
 // Staff display name is omitted until the canonical staff roster has been resolved.
 add(fields,"concerns",arr(a.concerns));add(fields,"client_focus",str(a.clientFocus));
 add(fields,"comparison_to_last",str(a.comparisonToLast));
 add(fields,"sensitivity_level",typeof a.sensitivityLevel==="number"&&Number.isFinite(a.sensitivityLevel)?a.sensitivityLevel:null);
 add(fields,"body_markers",Array.isArray(t.body_markers)?t.body_markers.map((v:unknown)=>{const m=obj(v);return str(m.area)}).filter((v):v is string=>!!v).slice(0,20):[]);
 add(fields,"body_map_note",str(t.body_map_note));add(fields,"discomfort_note",str(t.discomfort_note));
 add(fields,"client_feeling",str(t.client_feeling));
 add(fields,"products",Array.isArray(t.products)?t.products.map((v:unknown)=>{const p=obj(v);return str(p.label)??str(v)}).filter((v):v is string=>!!v).slice(0,20):[]);
 add(fields,"follow_up_note",str(f.note));add(fields,"follow_up_tags",arr(f.tags));
 add(fields,"suggest_next_booking",typeof f.suggestNextBooking==="boolean"?f.suggestNextBooking:null);
 add(fields,"suggested_date",str(f.suggestedDate));add(fields,"suggested_tracking_areas",arr(t.suggested_tracking_areas));
 return fields;
}
export async function previewMemberTreatmentPublication(organizationId:string,treatmentId:string):Promise<Preview>{
 const {db,t,org,consultationFields}=await context(organizationId,treatmentId);
 const {data:existing,error}=await db.from("member_treatment_publications").select("approved_fields,revoked_at").eq("treatment_id",t.id).eq("organization_id",org.id).maybeSingle();
 if(error)throw Error("無法讀取公開狀態");
 return {status:existing&&!existing.revoked_at?"published":"draft",fields:makeSnapshot(t,consultationFields),publishedKeys:existing&&!existing.revoked_at?Object.keys(obj(existing.approved_fields)):[],approvedConsultationLabels:existing&&!existing.revoked_at&&Array.isArray(obj(existing.approved_fields).consultation_answers)?(obj(existing.approved_fields).consultation_answers as unknown[]).map(v=>str(obj(v).label)).filter((v):v is string=>!!v):[],completedAt:t.completed_at};
}
export async function publishMemberTreatment(organizationId:string,treatmentId:string,approvedFields:PublicFields){
 const {db,t,auth,consultationFields}=await context(organizationId,treatmentId);
 const candidate=makeSnapshot(t,consultationFields);
 const clean:PublicFields={};
 for(const [key,value] of Object.entries(approvedFields)){
  if(key==="consultation_answers"&&Array.isArray(value)&&Array.isArray(candidate[key])){
   const available=candidate[key] as Array<{label:string;value:string}>;
   const chosen=value as Array<{label:string;value:string}>;
   if(chosen.length>available.length||chosen.some(item=>!available.some(row=>row.label===item.label&&row.value===item.value))||new Set(chosen.map(item=>item.label)).size!==chosen.length)throw Error("公開資料已變更，請重新預覽");
  }else if(!(key in candidate)||JSON.stringify(candidate[key])!==JSON.stringify(value))throw Error("公開資料已變更，請重新預覽");
  clean[key]=value;
 }
 const {error}=await db.from("member_treatment_publications").upsert({
  treatment_id:t.id,organization_id:t.organization_id,customer_id:t.customer_id,
  approved_fields:clean,approved_by:auth.membership.userId,
  approved_at:new Date().toISOString(),revoked_at:null,updated_at:new Date().toISOString()
 },{onConflict:"treatment_id"});
 if(error)throw Error("公開失敗，請稍後再試");
 return {ok:true};
}
export async function revokeMemberTreatment(organizationId:string,treatmentId:string){
 const {db,t}=await context(organizationId,treatmentId);
 const {error}=await db.from("member_treatment_publications").update({revoked_at:new Date().toISOString(),updated_at:new Date().toISOString()})
 .eq("treatment_id",t.id).eq("organization_id",t.organization_id).is("revoked_at",null);
 if(error)throw Error("撤銷失敗");
 return {ok:true};
}

/** Automatically publish an authenticated staff member's completed remote treatment.
 * The treatment and customer must already exist in the authoritative database.
 * The snapshot is generated server-side; callers cannot supply public fields.
 */
async function readPublication(db:NonNullable<ReturnType<typeof createServiceRoleClient>>,treatmentDbId:string,organizationDbId:string):Promise<ExistingPublication>{
 if(!db)throw Error("資料庫尚未設定");
 const {data,error}=await db.from("member_treatment_publications")
  .select("customer_id,approved_fields,revoked_at")
  .eq("treatment_id",treatmentDbId).eq("organization_id",organizationDbId).maybeSingle();
 if(error)throw Error("無法確認會員公開狀態，請稍後重試");
 return data??null;
}
async function memberLabels(db:NonNullable<ReturnType<typeof createServiceRoleClient>>,t:Record<string,unknown>,organizationAppId:string){
 let serviceName:string|null=null;
 if(typeof t.service_id==="string"&&t.service_id){
  const service=await db.from("services").select("name").eq("id",t.service_id).eq("organization_id",t.organization_id).maybeSingle();
  if(service.error)throw Error("無法確認課程名稱，請稍後重試");
  serviceName=str(service.data?.name);
 }
 let staffName:string|null=null;
 if(typeof t.staff_id==="string"&&t.staff_id){
  const staff=await db.from("staff_auth_memberships").select("display_name").eq("user_id",t.staff_id).eq("organization_id",organizationAppId).maybeSingle();
  if(staff.error)throw Error("無法確認美容師名稱，請稍後重試");
  staffName=str(staff.data?.display_name);
 }
 return {serviceName,staffName};
}
function mirrorFromTreatment(t:Record<string,unknown>,financeOrganizationId:string,financeCustomerId:string,labels:{serviceName:string|null;staffName:string|null}):MirrorRecord{
 return {
  treatment_id:String(t.id),
  organization_id:financeOrganizationId,
  customer_id:financeCustomerId,
  booking_customer_id:String(t.customer_id),
  status:"COMPLETED",
  completed_at:String(t.completed_at),
  service_name:labels.serviceName,
  staff_name:labels.staffName,
  assessment:t.assessment??{},
  body_markers:t.body_markers??[],
  body_map_note:str(t.body_map_note),
  professional_note:typeof t.professional_note==="string"?t.professional_note.trim().slice(0,4000):null,
  client_feeling:str(t.client_feeling),
  discomfort_note:str(t.discomfort_note),
  follow_up:t.follow_up??{},
  products:t.products??[],
  suggested_tracking_areas:Array.isArray(t.suggested_tracking_areas)?t.suggested_tracking_areas:[],
 };
}
const MIRROR_READ_FAILED="療程已儲存，但無法確認會員同步狀態，請稍後重試。";
async function publicationApprover(
 db:NonNullable<ReturnType<typeof createServiceRoleClient>>,
 organizationId:string,
 membership:{authUserId?:string|null;userId:string},
){
 const session=await getServerStaffAuthUser();
 const membershipRows=await db.from("staff_auth_memberships")
  .select("auth_user_id,user_id,role,is_active,organization_id")
  .eq("auth_user_id",session?.id??"")
  .eq("organization_id",organizationId)
  .eq("user_id",membership.userId)
  .limit(2);
 if(membershipRows.error)throw Error("無法確認操作人員身分，未公開給會員。");
 const approvedBy=verifiedBookingPublicationApprover({
  sessionUserId:session?.id??null,
  membershipAuthUserId:membership.authUserId??null,
  membershipUserId:membership.userId,
  organizationId,
  rows:membershipRows.data??[],
 });
 if(!approvedBy)throw Error("無法確認操作人員身分，未公開給會員。");
 return approvedBy;
}
async function insertPublicationOnce(
 db:NonNullable<ReturnType<typeof createServiceRoleClient>>,
 row:{treatmentId:string;organizationId:string;customerId:string;fields:Record<string,unknown>;approvedBy:string},
):Promise<"ok"|"conflict"|"error"|"revoked"|"mismatch">{
 const {data,error}=await db.rpc("insert_member_treatment_publication_once",{
  p_treatment_id:row.treatmentId,
  p_organization_id:row.organizationId,
  p_customer_id:row.customerId,
  p_approved_fields:row.fields,
  p_approved_by:row.approvedBy,
 });
 if(error||typeof data!=="string")return "error";
 if(data==="inserted")return "ok";
 if(data==="already")return "conflict";
 if(data==="revoked"||data==="mismatch")return data;
 if(data==="unauthorized")return "error";
 return "error";
}
export async function autoPublishCompletedMemberTreatment(organizationId:string,treatmentId:string){
 // Booking stays the Beauty OS writer. Finance stays the member reader.
 // A refused pairing writes nothing and does not create another treatment.
 const mode=assertMemberPublicationTarget();
 const {db,t,auth,org,consultationFields}=await context(organizationId,treatmentId,true);
 if(!memberSyncCustomerAllowed(t.customer_id))throw Error("這位顧客不在會員同步允許名單，未公開給任何會員。");
 const approvedBy=await publicationApprover(db,organizationId,auth.membership);
 const labels=await memberLabels(db,t,organizationId);
 const photoRefs=privatePhotoRefsFromMeta(t.id,t.photo_meta);
 if(!photoRefs.ok)throw Error(photoRefs.error);
 const publicationTarget=mode==="same-finance"?db:createBeautyOsFinanceClient();
 if(photoRefs.photos.length){
  if(!publicationTarget)throw Error("會員照片儲存尚未設定，尚未同步。");
  const confirmed=await confirmPrivateTreatmentPhotos(t.id,photoRefs.photos,{
   async stat(key){
    const folder=key.slice(0,key.lastIndexOf("/"));
    const name=key.slice(folder.length+1);
    const listed=await publicationTarget.storage.from(MEMBER_TREATMENT_PHOTO_BUCKET).list(folder,{limit:10,search:name});
    if(listed.error)return "error";
    return listed.data?.some((file)=>file.name===name)?"present":"missing";
   },
  });
  if(!confirmed.ok)throw Error(confirmed.error);
 }
 const fields={...makeSnapshot(t,consultationFields),...(photoRefs.photos.length?{photos:photoRefs.photos}:{}),status:"COMPLETED",completed_at:t.completed_at,...(labels.serviceName?{service_name:labels.serviceName}:{}),...(labels.staffName?{staff_name:labels.staffName}:{})};
 if(!publicationTarget)throw Error("會員讀取資料庫尚未設定，未另建療程。");
 let financeOrganizationId=org.id;
 let financeCustomerId=t.customer_id;
 if(mode==="booking-to-finance"){
  const financeOrg=await publicationTarget.from("organizations").select("id").eq("app_id",organizationId).maybeSingle();
  if(financeOrg.error||!financeOrg.data?.id)throw Error(MEMBER_IDENTITY_UNVERIFIED);
  financeOrganizationId=financeOrg.data.id;
  const links=await publicationTarget.from("member_booking_finance_identity_links")
   .select("finance_customer_id,finance_confirmation_id")
   .eq("organization_id",financeOrganizationId)
   .eq("booking_organization_id",org.id)
   .eq("booking_customer_id",t.customer_id)
   .is("revoked_at",null).limit(2);
  if(links.error)throw Error(MEMBER_IDENTITY_UNVERIFIED);
  const evidence=[];
  for(const link of links.data??[]){
   const confirmation=await publicationTarget.from("member_finance_binding_challenges").select("id")
    .eq("id",link.finance_confirmation_id).eq("organization_id",financeOrganizationId)
    .eq("confirmed_customer_id",link.finance_customer_id).eq("status","CONFIRMED").not("confirmed_at","is",null).maybeSingle();
   const customer=await publicationTarget.from("customers").select("id,status")
    .eq("id",link.finance_customer_id).eq("organization_id",financeOrganizationId).maybeSingle();
   const line=await publicationTarget.from("member_line_customer_links").select("verified_at")
    .eq("organization_id",financeOrganizationId).eq("customer_id",link.finance_customer_id).limit(2);
   if(confirmation.error||customer.error||line.error)throw Error(MEMBER_IDENTITY_UNVERIFIED);
   const lineRows=line.data??[];
   evidence.push({
    financeCustomerId:customer.data?.id??"",
    confirmationStatus:confirmation.data?"CONFIRMED":null,
    customerStatus:customer.data?.status??null,
    verifiedLineSubjects:lineRows.length===1&&lineRows[0].verified_at?1:0,
   });
  }
  const member=financeMemberFromEvidence(evidence);
  if(!member)throw Error(MEMBER_IDENTITY_UNVERIFIED);
  financeCustomerId=member.customerId;
  const mirror=mirrorFromTreatment(t,financeOrganizationId,financeCustomerId,labels);
  const readMirror=async()=>{
   const row=await publicationTarget.from("member_treatment_mirrors")
    .select("treatment_id,organization_id,customer_id,booking_customer_id,status,completed_at,service_name,staff_name,assessment,body_markers,body_map_note,professional_note,client_feeling,discomfort_note,follow_up,products,suggested_tracking_areas")
    .eq("treatment_id",t.id).maybeSingle();
   if(row.error)throw Error(MIRROR_READ_FAILED);
   return row.data as MirrorRecord|null;
  };
  await commitMemberTreatmentCopy({
   mirror,
   fields,
   readMirror,
   insertMirror:async()=>{
    const {error}=await publicationTarget.from("member_treatment_mirrors").insert(mirror);
    if(!error)return "ok";
    if(error.code==="23505")return "conflict";
    return "error";
   },
   readPublication:()=>readPublication(publicationTarget,t.id,financeOrganizationId),
   insertPublication:()=>insertPublicationOnce(publicationTarget,{
    treatmentId:t.id,organizationId:financeOrganizationId,customerId:financeCustomerId,fields,approvedBy,
   }),
  });
  return {ok:true};
 }
 // The completed treatment row stays completed when publication fails.
 // A later press inserts the missing publication or verifies the existing one.
 // It does not create another treatment and does not clear revoked_at.
 await commitAutomaticPublication({
  customerId:financeCustomerId,
  fields,
  read:()=>readPublication(publicationTarget,t.id,financeOrganizationId),
  insert:()=>insertPublicationOnce(publicationTarget,{
   treatmentId:t.id,organizationId:financeOrganizationId,customerId:financeCustomerId,fields,approvedBy,
  }),
 });
 return {ok:true};
}
