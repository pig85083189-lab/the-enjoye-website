import { NextResponse } from "next/server";
import { getAuthenticatedStaffMembership, getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { createClient } from "@/lib/supabase/server";
import { createBeautyOsFinanceClient } from "@/lib/supabase/beauty-os-finance";
import { validatePublication } from "@/lib/lucky-draw/publication";

export async function POST(request:Request){
 const headers={"Cache-Control":"private, no-store"};
 const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
 if(request.headers.get("origin")!==new URL(request.url).origin)return fail(403,"INVALID_ORIGIN");
 let body:Record<string,unknown>;
 try{body=await request.json();if(!body||typeof body!=="object")return fail(400,"INVALID_INPUT");}catch{return fail(400,"INVALID_INPUT");}
 const {organizationId,action,campaignId,expected}=body;
 if(typeof organizationId!=="string"||!organizationId.trim()||organizationId.length>120)return fail(400,"INVALID_INPUT");
 const identity=await getAuthenticatedStaffMembership({organizationId});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return fail(403,"FORBIDDEN");
 if(action!=="publish"&&action!=="activate"&&action!=="pause"&&action!=="end")return fail(400,"INVALID_ACTION");
 const finance=createBeautyOsFinanceClient();if(!finance)return fail(503,"CONFIG_MISSING");
 const org=await finance.from("organizations").select("id").eq("app_id",organizationId).single();
 if(org.error||!org.data)return fail(503,"ORG_UNAVAILABLE");
 if(action==="publish"){
  const booking=await createClient();
  const bOrg=await booking.from("organizations").select("id").eq("app_id",organizationId).single();
  if(bOrg.error||!bOrg.data)return fail(403,"ORG_UNAVAILABLE");
  const draft=await booking.from("lucky_draw_campaign_drafts").select("name,starts_on,ends_on,rules,prizes").eq("organization_id",bOrg.data.id).single();
  if(draft.error||!draft.data)return fail(409,"DRAFT_REQUIRED");
  let validated:ReturnType<typeof validatePublication>;
  try{validated=validatePublication({name:draft.data.name,startsOn:draft.data.starts_on,endsOn:draft.data.ends_on,rules:draft.data.rules,prizes:draft.data.prizes});}
  catch{return fail(422,"INVALID_DRAFT");}
  if(process.env.LUCKY_DRAW_PUBLICATION_ENABLED!=="true")return fail(503,"PUBLICATION_NOT_ENABLED");
  const actor=await getServerStaffAuthUser();if(!actor)return fail(403,"FORBIDDEN");
  const result=await finance.rpc("lucky_draw_publish",{p_org:org.data.id,p_name:validated.name,p_start:validated.startsOn,p_end:validated.endsOn,p_rules:validated.rules,p_prizes:validated.prizes,p_actor:actor.id});
  if(result.error)return fail(409,"PUBLICATION_FAILED");
  return NextResponse.json({campaignId:result.data,status:"paused"},{headers});
 }
 if(typeof campaignId!=="string"||! /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(campaignId)||(expected!=="active"&&expected!=="paused"))return fail(400,"INVALID_INPUT");
 if(process.env.LUCKY_DRAW_PUBLICATION_ENABLED!=="true")return fail(503,"LIFECYCLE_NOT_ENABLED");
 const next=action==="activate"?"active":action==="pause"?"paused":"ended";
 const result=await finance.rpc("lucky_draw_transition",{p_org:org.data.id,p_id:campaignId,p_expected:expected,p_next:next});
 if(result.error)return fail(409,"TRANSITION_FAILED");
 return NextResponse.json({campaignId,status:result.data},{headers});
}

export async function GET(request:Request){
 const headers={"Cache-Control":"private, no-store"};
 const fail=(status:number,code:string)=>NextResponse.json({code},{status,headers});
 const organizationId=new URL(request.url).searchParams.get("organizationId")?.trim();
 if(!organizationId||organizationId.length>120)return fail(400,"INVALID_INPUT");
 const identity=await getAuthenticatedStaffMembership({organizationId});
 if(identity.status!=="ok"||!["OWNER","MANAGER"].includes(identity.membership.role))return fail(403,"FORBIDDEN");
 const finance=createBeautyOsFinanceClient();if(!finance)return fail(503,"CONFIG_MISSING");
 const org=await finance.from("organizations").select("id").eq("app_id",organizationId).single();
 if(org.error||!org.data)return fail(503,"ORG_UNAVAILABLE");
 const campaign=await finance.from("lucky_draw_campaigns").select("id,name,version,status").eq("organization_id",org.data.id).order("version",{ascending:false}).limit(1).maybeSingle();
 if(campaign.error)return fail(503,"STATUS_UNAVAILABLE");
 return NextResponse.json({campaign:campaign.data,enabled:process.env.LUCKY_DRAW_PUBLICATION_ENABLED==="true"},{headers});
}
