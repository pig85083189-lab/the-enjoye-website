import type { LuckyDrawRules } from "./rules";
export type CampaignStatus = "draft" | "active" | "paused" | "ended";
export type PrizeDraft = { tier: string; name: string; weight: string; stock: string };
export type CampaignDraft = { name: string; startsOn: string; endsOn: string; rules: LuckyDrawRules; prizes: PrizeDraft[] };
const tiers = new Set(["大獎","二獎","參獎","小獎"]);
function validDate(s:string):boolean {
 if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return false;
 const d=new Date(s+"T00:00:00Z");
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===s;
}
export function validatePublication(d:CampaignDraft){
 if(!d.name.trim()||d.name.trim().length>200)throw new Error("活動名稱不正確");
 if(!validDate(d.startsOn)||!validDate(d.endsOn)||d.endsOn<d.startsOn)throw new Error("活動日期不正確");
 const rules=d.rules;
 for(const [enabled,n] of [[rules.spend.enabled,rules.spend.amountMinor],[rules.points.enabled,rules.points.pointsPerDraw],[rules.treatment.enabled,rules.treatment.drawsPerTreatment],[rules.birthday.enabled,rules.birthday.drawsPerYear]]){
  if(typeof enabled!=="boolean"||typeof n!=="number"||!Number.isSafeInteger(n)||n<1)throw new Error("資格設定不正確");
 }
 if(typeof rules.manual.enabled!=="boolean")throw new Error("手動贈送設定不正確");
 if(!d.prizes.length||d.prizes.length>100)throw new Error("請設定有效獎品");
 const prizes=d.prizes.map(p=>{
  if(!tiers.has(p.tier)||!p.name.trim()||p.name.trim().length>200||!/^\d+(\.\d{1,2})?$/.test(p.weight)||!/^\d+$/.test(p.stock))throw new Error("獎品設定不正確");
  const oddsBps=Math.round(Number(p.weight)*100),stock=Number(p.stock);
  if(!Number.isSafeInteger(oddsBps)||oddsBps<0||oddsBps>10000||!Number.isSafeInteger(stock)||stock<0||(oddsBps>0&&stock===0))throw new Error("獎品機率或庫存不正確");
  return {tier:p.tier,name:p.name.trim(),oddsBps,stock};
 });
 if(prizes.reduce((sum,p)=>sum+p.oddsBps,0)!==10000)throw new Error("中獎機率必須合計100%");
 return {name:d.name.trim(),startsOn:d.startsOn,endsOn:d.endsOn,rules,prizes};
}
export function canTransition(from:CampaignStatus,to:CampaignStatus):boolean {
 return (from==="draft"&&to==="active")||(from==="active"&&(to==="paused"||to==="ended"))||(from==="paused"&&(to==="active"||to==="ended"));
}
