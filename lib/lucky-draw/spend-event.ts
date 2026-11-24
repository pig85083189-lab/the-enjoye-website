import {spendDraws,type LuckyDrawRules} from "./rules";
export type SpendTender={method:string;amount:number};
export function eligibleSpend(total:number,tenders:readonly SpendTender[]):number {
 if(!Number.isSafeInteger(total)||total<0)throw new Error("INVALID_TOTAL");
 let sum=0;
 for(const tender of tenders){
  if(!Number.isSafeInteger(tender.amount)||tender.amount<0)throw new Error("INVALID_TENDER");
  if(!["CASH","CARD","TRANSFER","STORED_VALUE","PACKAGE"].includes(tender.method))throw new Error("UNKNOWN_TENDER");
  if(tender.method!=="PACKAGE")sum+=tender.amount;
 }
 if(!Number.isSafeInteger(sum)||sum>total)throw new Error("TENDER_TOTAL_MISMATCH");
 return sum;
}
export function spendEvent(input:{source:"booking"|"finance";transactionId:string;status:string;kind:"checkout"|"package_purchase"|"top_up"|"package_redemption";total:number;tenders:readonly SpendTender[]},rules:LuckyDrawRules){
 if(input.status!=="COMPLETED"||input.kind==="top_up"||input.kind==="package_redemption")return null;
 if(!input.transactionId.trim()||input.transactionId.length>200)throw new Error("INVALID_TRANSACTION");
 const amount=eligibleSpend(input.total,input.tenders);
 const quantity=spendDraws(amount,rules);
 return quantity>0?{source:"spend" as const,key:input.source+":"+input.transactionId,amount,quantity}:null;
}
