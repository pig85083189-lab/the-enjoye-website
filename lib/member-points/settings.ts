import "server-only";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
// Internal only. Route must resolve organization from authenticated manager session.
export async function readPointsSettings(org:string){
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("FINANCE_CONFIG");
 const r=await db.from("member_points_settings").select("enabled,spend_per_point,enabled_at,updated_at").eq("organization_id",org).maybeSingle();
 if(r.error)throw new Error("POINTS_SETTINGS_READ");
 return r.data??{enabled:false,spend_per_point:100,enabled_at:null,updated_at:null};
}
export async function savePointsSettings(org:string,input:{enabled:boolean;spendPerPoint:number}){
 if(typeof input.enabled!=="boolean"||!Number.isSafeInteger(input.spendPerPoint)||input.spendPerPoint<1||input.spendPerPoint>1000000)throw new Error("INVALID_POINTS_SETTINGS");
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("FINANCE_CONFIG");
 const r=await db.rpc("member_points_save_settings",{p_org:org,p_enabled:input.enabled,p_spend:input.spendPerPoint});
 if(r.error)throw new Error("POINTS_SETTINGS_WRITE");
 return readPointsSettings(org);
}
