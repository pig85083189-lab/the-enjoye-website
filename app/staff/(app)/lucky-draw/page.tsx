"use client";
import { useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { DEFAULT_LUCKY_DRAW_RULES } from "@/lib/lucky-draw/rules";
const tiers = ["大獎","二獎","參獎","小獎"] as const;
type Tier = typeof tiers[number];
const initial = [
  {label:"消費滿額", unit:"元／次", value:DEFAULT_LUCKY_DRAW_RULES.spend.amountMinor},
  {label:"會員點數兌換", unit:"點／次", value:DEFAULT_LUCKY_DRAW_RULES.points.pointsPerDraw},
  {label:"完成療程", unit:"次／療程", value:DEFAULT_LUCKY_DRAW_RULES.treatment.drawsPerTreatment},
  {label:"生日禮遇", unit:"次／年", value:DEFAULT_LUCKY_DRAW_RULES.birthday.drawsPerYear},
];
export default function LuckyDrawPage() {
  const {membership, organization} = useOrganization();
  if (!membership || !["OWNER","MANAGER"].includes(membership.role)) return <p>僅主管及店長可管理抽獎活動。</p>;
  return <Draft key={organization.id}/>;
}
function Draft() {
  const [name,setName]=useState("幸運寵愛轉盤");
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [rules,setRules]=useState(initial.map(r=>({...r,enabled:true,value:String(r.value)})));
  const [manual,setManual]=useState(true);
  const [prizes,setPrizes]=useState<{tier:Tier;name:string;weight:string;stock:string}[]>([]);
  const validWeight=(v:string)=>/^\d+(\.\d{1,2})?$/.test(v)&&Number(v)<=100;
  const basisPoints=(v:string)=>validWeight(v)?Math.round(Number(v)*100):0;
  const total=prizes.reduce((sum,p)=>sum+basisPoints(p.weight),0);
  const valid=prizes.length>0&&prizes.every(p=>p.name.trim()&&validWeight(p.weight)&&/^\d+$/.test(p.stock)&&Number.isSafeInteger(Number(p.stock))&&(basisPoints(p.weight)===0||Number(p.stock)>0));
  const field="w-full rounded-xl border border-border bg-surface px-3 py-2 text-text";
  const panel="rounded-2xl border border-border bg-surface p-5 space-y-4";
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold text-text">抽獎活動管理</h1><p className="mt-2 text-sm text-secondary-text">設定預覽 · 尚未連接資料庫，不會發放或扣除任何會員權益。</p></header>
    <section className={panel}><h2 className="font-semibold">活動設定</h2>
      <label className="block">活動名稱<input className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
      <div className="grid gap-3 sm:grid-cols-2"><label>開始日期<input type="date" className={field} value={start} onChange={e=>setStart(e.target.value)}/></label><label>結束日期<input type="date" min={start} className={field} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
      <p className="text-sm text-secondary-text">活動狀態：未發布</p>
    </section>
    <section className={panel}><h2 className="font-semibold">抽獎資格設定</h2>
      {rules.map((r,i)=><div key={r.label} className="space-y-2 border-b border-border pb-3"><label className="flex justify-between gap-3">{r.label}<input type="checkbox" checked={r.enabled} onChange={e=>setRules(old=>old.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x))}/></label>{r.enabled&&<label className="flex items-center gap-3"><input type="number" min="1" step="1" className={field} value={r.value} onChange={e=>setRules(old=>old.map((x,j)=>j===i?{...x,value:e.target.value}:x))}/><span className="shrink-0 text-sm">{r.unit}</span></label>}</div>)}
      <label className="flex justify-between">店長手動贈送<input type="checkbox" checked={manual} onChange={e=>setManual(e.target.checked)}/></label>
    </section>
    <section className={panel}><h2 className="font-semibold">獎品管理</h2>
      <p className="text-sm text-secondary-text">各獎品機率為單次抽獎的絕對機率，四個等級合計須為 100%。</p>
      {tiers.map(tier=><div key={tier} className="space-y-3 rounded-xl border border-border p-4">
        <div className="flex items-center justify-between"><h3 className="font-semibold">{tier}</h3><span className="text-sm text-secondary-text">合計 {(prizes.filter(p=>p.tier===tier).reduce((sum,p)=>sum+basisPoints(p.weight),0)/100).toFixed(2)}%</span></div>
        {prizes.map((p,i)=>p.tier===tier?<div key={i} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-3">{(["name","weight","stock"] as const).map((k,j)=><label key={k}>{["獎品名稱","中獎機率 (%)","庫存"][j]}<input className={field} type={k==="name"?"text":"number"} min="0" step={k==="weight"?"0.01":"1"} max={k==="weight"?100:undefined} value={p[k]} onChange={e=>setPrizes(old=>old.map((x,n)=>n===i?{...x,[k]:e.target.value}:x))}/></label>)}<button type="button" className="text-left text-sm text-secondary-text" onClick={()=>setPrizes(old=>old.filter((_,n)=>n!==i))}>移除未儲存獎品</button></div>:null)}
        <button type="button" className="rounded-xl border border-border px-4 py-2" onClick={()=>setPrizes(old=>[...old,{tier,name:"",weight:"0",stock:"0"}])}>＋ 新增{tier}</button>
      </div>)}
      <p>機率合計：{(total/100).toFixed(2)}%</p>
      <p role="status" className="text-sm text-secondary-text">{total===10000&&valid?"獎品設定檢查通過（尚未發布）":"發布前須合計 100%，獎品名稱、機率及庫存均須有效。"}</p>
    </section>
    <p className="text-sm text-secondary-text">目前僅為未儲存的設定預覽；重新整理會恢復預設值。</p>
  </div>;
}
