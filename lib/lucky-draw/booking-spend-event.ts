import type {Transaction} from "@/lib/commerce/domain";
import {spendEvent} from "./spend-event";
import type {LuckyDrawRules} from "./rules";

// Only call with the authenticated settlement RPC response, never request JSON.
// Finance wallet mirror transactions must not be processed as separate spend.
export function bookingSpendEvent(transaction:Transaction|null,rules:LuckyDrawRules){
 if(!transaction)return null;
 return spendEvent({
  source:"booking",
  transactionId:transaction.id,
  status:transaction.status,
  kind:transaction.packageRedemption?"package_redemption":"checkout",
  total:transaction.total,
  tenders:transaction.payments.map(p=>({method:p.method,amount:p.amount})),
 },rules);
}
