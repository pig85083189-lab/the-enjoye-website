import { describe, it, expect, vi, beforeEach } from "vitest";
const h = vi.hoisted(() => ({ booking: {from:vi.fn()}, finance:{from:vi.fn(),rpc:vi.fn()}, member:vi.fn() }));
vi.mock("server-only",()=>({}));
vi.mock("@/lib/supabase/admin",()=>({createServiceRoleClient:()=>h.booking}));
vi.mock("@/lib/supabase/beauty-os-finance",()=>({createBeautyOsFinanceClient:()=>h.finance}));
vi.mock("./reconcile-member",()=>({verifyRewardMember:h.member}));
import {reconcileSpendEvent} from "./reconcile-spend-event";
import {reconcileFinanceEvent} from "./reconcile-finance-purchase";
import {reconcileRewardOutbox, type RewardEvent} from "./outbox-worker";
const event:RewardEvent={transaction_id:"tx",organization_id:"org",revision:1,desired_status:"COMPLETED",attempts:0};
const tx={status:"COMPLETED",completed_at:"2026-11-25T00:00:00Z",voided_at:null,customer_id:"customer",total_minor:2500,treatment_id:"treatment",package_redemption:false};
function query(data:unknown, error:unknown=null){
 const result={data,error};
 const q={select:vi.fn(),eq:vi.fn(),lte:vi.fn(),order:vi.fn(),limit:vi.fn(),single:vi.fn(),update:vi.fn(),then:(resolve:(v:typeof result)=>unknown)=>Promise.resolve(result).then(resolve)};
 for(const k of ["select","eq","lte","order","limit","single","update"] as const)q[k].mockReturnValue(q);
 return q;
}
beforeEach(()=>{vi.resetAllMocks();h.member.mockResolvedValue({financeOrg:"finance",financeCustomer:"member",verifiedHash:"hash"});});
describe("reward background isolation (mocked database boundary)",()=>{
 it("passes authoritative checkout amount to finance RPC",async()=>{
 h.booking.from.mockImplementation((t)=>query(t==="transactions"?tx:[{method:"CASH",amount_minor:2500}]));
 h.finance.rpc.mockResolvedValue({data:1,error:null});
 expect(await reconcileSpendEvent(event)).toEqual({state:"done",code:"GRANTED"});
 expect(h.finance.rpc).toHaveBeenCalledWith("lucky_draw_grant_booking_spend",expect.objectContaining({p_amount:2500,p_transaction:"tx"}));
 });
 it("accepts fixed grant for below-threshold checkout",async()=>{
 h.booking.from.mockImplementation((t)=>query(t==="transactions"?{...tx,total_minor:500}:[{method:"CASH",amount_minor:500}]));
 h.finance.rpc.mockResolvedValue({data:1,error:null});
 expect((await reconcileSpendEvent(event)).state).toBe("done");
 expect(h.finance.rpc).toHaveBeenCalledWith("lucky_draw_grant_booking_spend",expect.objectContaining({p_amount:500}));
 });
 it("excludes package redemption",async()=>{
 h.booking.from.mockReturnValue(query({...tx,package_redemption:true}));
 expect(await reconcileSpendEvent(event)).toEqual({state:"done",code:"NOT_ELIGIBLE"});
 expect(h.finance.rpc).not.toHaveBeenCalled();
 });
 it("routes package purchase and replay with same transaction key",async()=>{
 h.finance.from.mockImplementation(t=>query(t==="transactions"?tx:[{id:"package"}]));
 h.finance.rpc.mockResolvedValue({data:2,error:null});
 for(let i=0;i<2;i++)expect((await reconcileFinanceEvent(event)).state).toBe("done");
 expect(h.finance.rpc.mock.calls).toEqual(Array(2).fill(["lucky_draw_grant_finance_purchase",{p_org:"org",p_transaction:"tx"}]));
 });
 it("fences cancellation before reversal and accepts replay",async()=>{
 h.finance.from.mockImplementation(t=>query(t==="transactions"?{...tx,status:"VOIDED",voided_at:tx.completed_at}:[{campaign_id:"campaign"}]));
 h.finance.rpc.mockImplementation(async(name)=>({data:name==="lucky_draw_reverse_spend"?"ALREADY_REVERSED":null,error:null}));
 expect(await reconcileFinanceEvent({...event,desired_status:"VOIDED"})).toEqual({state:"done",code:"REVERSED"});
 expect(h.finance.rpc.mock.calls.map(c=>c[0])).toEqual(["lucky_draw_mark_spend_cancelled","lucky_draw_reverse_spend"]);
 });
 it.each([0,9])("backs off failure at attempt %i",async(attempts)=>{
 const read=query([{...event,attempts}]), write=query([{transaction_id:"tx"}]);
 h.booking.from.mockReturnValueOnce(read).mockReturnValueOnce(write);
 const start=Date.now();
 expect(await reconcileRewardOutbox(async()=>{throw Error("temporary");})).toEqual({processed:1});
 expect(write.update).toHaveBeenCalledWith(expect.objectContaining({state:attempts===9?"review":"pending",attempts:attempts+1,last_code:"PROCESS_FAILED"}));
 expect(Date.parse(write.update.mock.calls[0][0].next_attempt_at)).toBeGreaterThan(start);
 expect(write.eq).toHaveBeenCalledWith("revision",1);
 expect(write.eq).toHaveBeenCalledWith("attempts",attempts);
 });
});
