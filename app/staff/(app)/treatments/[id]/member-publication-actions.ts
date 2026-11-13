"use server";

import { getAuthenticatedStaffMembership } from "@/lib/staff-auth/server";
import { createServiceRoleClient } from "@/lib/supabase/admin";

const allowedRoles = new Set(["OWNER","MANAGER"]);
type PublicFields = Record<string, string | string[] | number | boolean>;
type Preview = { status:"draft"|"published"; fields:PublicFields; completedAt:string };

function str(v:unknown):string|null {return typeof v==="string"&&v.trim()?v.trim().slice(0,500):null;}
function arr(v:unknown):string[]{return Array.isArray(v)?v.map(str).filter((x):x is string=>!!x).slice(0,20):[];}
function obj(v:unknown):Record<string,unknown>{return v&&typeof v==="object"&&!Array.isArray(v)?v as Record<string,unknown>:{};}
function add(target:PublicFields,key:string,value:string|string[]|number|boolean|null) {
 if(value!==null&&(!Array.isArray(value)||value.length>0))target[key]=value;
}
async function context(organizationId:string,treatmentId:string){
 if(!/^[0-9a-f-]{36}$/i.test(organizationId)||!treatmentId||treatmentId.length>160)throw Error("無效的療程資料");
 const auth=await getAuthenticatedStaffMembership({organizationId});
 if(auth.status!=="ok"||!allowedRoles.has(auth.membership.role))throw Error("僅店長或主管可以審核公開");
 const db=createServiceRoleClient();
 if(!db)throw Error("資料庫尚未設定");
 const {data:matches,error}=await db.from("treatments").select("id,organization_id,customer_id,completed_at,status,staff_id,assessment,body_markers,body_map_note,discomfort_note,client_feeling,products,follow_up,suggested_tracking_areas")
  .eq("app_id",treatmentId).eq("organization_id",organizationId).eq("status","COMPLETED").not("completed_at","is",null).limit(2);
 const t=matches?.length===1?matches[0]:null;
 if(error||!t)throw Error("只有正式資料庫中已完成的療程可以公開");
 const {data:customer}=await db.from("customers").select("id").eq("id",t.customer_id).eq("organization_id",organizationId).eq("status","ACTIVE").maybeSingle();
 if(!customer)throw Error("顧客資料無效");
 return {db,t,auth};
}
function makeSnapshot(t:Record<string,unknown>):PublicFields {
 const a=obj(t.assessment),f=obj(t.follow_up),fields:PublicFields={};
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
 const {db,t}=await context(organizationId,treatmentId);
 const {data:existing,error}=await db.from("member_treatment_publications").select("approved_fields,revoked_at").eq("treatment_id",t.id).eq("organization_id",organizationId).maybeSingle();
 if(error)throw Error("無法讀取公開狀態");
 return {status:existing&&!existing.revoked_at?"published":"draft",fields:existing&&!existing.revoked_at?obj(existing.approved_fields) as PublicFields:makeSnapshot(t),completedAt:t.completed_at};
}
export async function publishMemberTreatment(organizationId:string,treatmentId:string,approvedFields:PublicFields){
 const {db,t,auth}=await context(organizationId,treatmentId);
 const candidate=makeSnapshot(t);
 const clean:PublicFields={};
 for(const [key,value] of Object.entries(approvedFields)){
  if(!(key in candidate)||JSON.stringify(candidate[key])!==JSON.stringify(value))throw Error("公開資料已變更，請重新預覽");
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
 .eq("treatment_id",t.id).eq("organization_id",organizationId).is("revoked_at",null);
 if(error)throw Error("撤銷失敗");
 return {ok:true};
}
