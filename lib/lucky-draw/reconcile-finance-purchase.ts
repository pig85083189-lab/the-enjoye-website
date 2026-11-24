import "server-only";
import {createBeautyOsFinanceClient} from "@/lib/supabase/beauty-os-finance";
import type {RewardOutcome} from "./outbox-worker";

// The finance RPC independently verifies completed purchase, tender,
// campaign and current member identity. Never grant from browser amounts.
export async function reconcileFinancePurchase(organizationId:string,transactionId:string):Promise<RewardOutcome>{
 const db=createBeautyOsFinanceClient();
 if(!db)throw new Error("FINANCE_CONFIG");
 const result=await db.rpc("lucky_draw_grant_finance_purchase",{p_org:organizationId,p_transaction:transactionId});
 if(result.error)throw new Error("FINANCE_PURCHASE_GRANT");
 return result.data===null?{state:"review",code:"PURCHASE_GRANT_NOT_CONFIRMED"}:{state:"done",code:"PURCHASE_GRANT_CONFIRMED"};
}
