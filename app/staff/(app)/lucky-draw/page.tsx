"use client";
import { useEffect, useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { DEFAULT_LUCKY_DRAW_RULES } from "@/lib/lucky-draw/rules";
import { createClient } from "@/lib/supabase/client";
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
  return <Draft key={organization.id} organizationId={organization.id}/>;
}
function Draft({organizationId}:{organizationId:string}) {
  const [name,setName]=useState("幸運寵愛轉盤");
  const [start,setStart]=useState("");
  const [end,setEnd]=useState("");
  const [rules,setRules]=useState(initial.map(r=>({...r,enabled:true,value:String(r.value)})));
  const [manual,setManual]=useState(true);
  const [prizes,setPrizes]=useState<{tier:Tier;name:string;weight:string;stock:string}[]>([]);
  const [dbId,setDbId]=useState("");
  const [busy,setBusy]=useState(true);
  const [message,setMessage]=useState("");
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      try {
        const client=createClient();
        const {data:org,error:orgError}=await client.from("organizations").select("id").eq("app_id",organizationId).single();
        if(orgError||!org) throw new Error("無法確認店家身分");
        const {data,error}=await client.from("lucky_draw_campaign_drafts").select("*").eq("organization_id",org.id).maybeSingle();
        if(error) throw error;
        if(cancelled)return;
        if(data){
          const r=data.rules;
          const values=[r.spend.amountMinor,r.points.pointsPerDraw,r.treatment.drawsPerTreatment,r.birthday.drawsPerYear];
          const enabled=[r.spend.enabled,r.points.enabled,r.treatment.enabled,r.birthday.enabled];
          if(!Array.isArray(data.prizes)||values.some(v=>!Number.isSafeInteger(v)||v<1)||enabled.some(v=>typeof v!=="boolean")||typeof r.manual.enabled!=="boolean")throw new Error("草稿格式不正確");
          setName(data.name);setStart(data.starts_on||"");setEnd(data.ends_on||"");
          setRules(initial.map((x,i)=>({...x,value:String(values[i]),enabled:enabled[i]})));
          setManual(r.manual.enabled);
          setPrizes(data.prizes);
        }
        setDbId(org.id);
      }catch{if(!cancelled)setMessage("讀取失敗，請重新整理或確認管理權限。");}
      finally{if(!cancelled)setBusy(false);}
    }
    void load();return()=>{cancelled=true;};
  },[organizationId]);
  async function save(){
    if(busy||!dbId)return;
    if(!name.trim()||name.trim().length>200||(start&&end&&end<start)||rules.some(r=>!Number.isSafeInteger(Number(r.value))||Number(r.value)<1)||prizes.some(p=>!p.name.trim()||!validWeight(p.weight)||!/^\d+$/.test(p.stock)||!Number.isSafeInteger(Number(p.stock)))){setMessage("請確認活動名稱、日期、資格數值與獎品欄位。");return;}
    setBusy(true);setMessage("");
    try{
      const client=createClient();
      const {error}=await client.from("lucky_draw_campaign_drafts").upsert({
        organization_id:dbId,name:name.trim(),starts_on:start||null,ends_on:end||null,
        rules:{spend:{enabled:rules[0].enabled,amountMinor:Number(rules[0].value)},points:{enabled:rules[1].enabled,pointsPerDraw:Number(rules[1].value)},treatment:{enabled:rules[2].enabled,drawsPerTreatment:Number(rules[2].value)},birthday:{enabled:rules[3].enabled,drawsPerYear:Number(rules[3].value)},manual:{enabled:manual}},
        prizes,status:"draft",updated_at:new Date().toISOString()
      },{onConflict:"organization_id"}).select("organization_id").single();
      if(error)throw error;
      setMessage("草稿已儲存，活動尚未發布。");
    }catch{setMessage("儲存失敗，請確認連線及管理權限。");}finally{setBusy(false);}
  }
  const validWeight=(v:string)=>/^\d+(\.\d{1,2})?$/.test(v)&&Number(v)<=100;
  const basisPoints=(v:string)=>validWeight(v)?Math.round(Number(v)*100):0;
  const total=prizes.reduce((sum,p)=>sum+basisPoints(p.weight),0);
  const valid=prizes.length>0&&prizes.every(p=>p.name.trim()&&validWeight(p.weight)&&/^\d+$/.test(p.stock)&&Number.isSafeInteger(Number(p.stock))&&(basisPoints(p.weight)===0||Number(p.stock)>0));
  const field="w-full rounded-xl border border-border bg-surface px-3 py-2 text-text";
  const panel="rounded-2xl border border-border bg-surface p-5 space-y-4";
  return <div className="space-y-5">
    <header><h1 className="text-2xl font-semibold text-text">抽獎活動管理</h1><p className="mt-2 text-sm text-secondary-text">草稿管理 · 不會發放或扣除任何會員權益。</p></header>
    <fieldset disabled={busy||!dbId} className="space-y-5 min-w-0">
    <section className={panel}><h2 className="font-semibold">活動設定</h2>
      <label className="block">活動名稱<input className={field} value={name} onChange={e=>setName(e.target.value)}/></label>
      <div className="grid gap-3 sm:grid-cols-2"><label>開始日期<input type="date" className={field} value={start} onChange={e=>setStart(e.target.value)}/></label><label>結束日期<input type="date" min={start} className={field} value={end} onChange={e=>setEnd(e.target.value)}/></label></div>
      <p className="text-sm text-secondary-text">此區為活動草稿設定。</p>
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
    <button type="button" disabled={busy||!dbId} onClick={()=>void save()} className="rounded-xl bg-primary px-5 py-3 text-white disabled:opacity-50">{busy?"處理中…":"儲存設定"}</button>
    </fieldset>
    <p role="status">{message}</p>
    <CampaignControls organizationId={organizationId}/>
    <MemberGrant organizationId={organizationId}/>
    <p className="text-sm text-secondary-text">儲存草稿不會發布活動；機率未滿 100% 仍可儲存草稿。</p>
  </div>;
}

type MemberOption={id:string;name:string;phoneSuffix:string};
function MemberGrant({organizationId}:{organizationId:string}){
 const [q,setQ]=useState("");
 const [members,setMembers]=useState<MemberOption[]>([]);
 const [selected,setSelected]=useState<MemberOption|null>(null);
 const [eligible,setEligible]=useState<boolean|null>(null);
 const [qty,setQty]=useState("1");
 const [reason,setReason]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const field="w-full rounded-xl border border-border bg-surface px-3 py-2 text-text";
 async function search(){
  setBusy(true);setSelected(null);setEligible(null);setMembers([]);setMessage("");
  try{
   const r=await fetch("/api/staff/lucky-draw/members?"+new URLSearchParams({organizationId,q:q.trim()}),{cache:"no-store"});
   if(!r.ok)throw new Error();
   const data=await r.json();setMembers(data.members);if(!data.members.length)setMessage("查無符合的會員");
  }catch{setMessage("會員查詢失敗");}finally{setBusy(false);}
 }
 async function choose(member:MemberOption){
  setBusy(true);setSelected(member);setEligible(null);setMessage("");
  try{
   const r=await fetch("/api/staff/lucky-draw/member?"+new URLSearchParams({organizationId,customerId:member.id}),{cache:"no-store"});
   if(!r.ok)throw new Error();
   const data=await r.json();setEligible(data.lineVerified===true);
  }catch{setMessage("資格查詢失敗");}finally{setBusy(false);}
 }
 return <section className="rounded-2xl border border-border bg-surface p-5 space-y-4">
 <h2 className="font-semibold">抽獎次數管理</h2>
 <p className="text-sm text-secondary-text">活動尚未發布，目前僅開放會員資格查詢。</p>
 <fieldset disabled={busy} className="space-y-3 min-w-0">
 <label className="block">會員姓名或手機<input className={field} value={q} maxLength={80} onChange={e=>{setQ(e.target.value);setMembers([]);setSelected(null);setEligible(null);setMessage("");}}/></label>
 <button type="button" disabled={busy||q.trim().length<2} className="rounded-xl border border-border px-4 py-2 disabled:opacity-50" onClick={()=>void search()}>搜尋會員</button>
 {members.map(m=><button type="button" key={m.id} className="block w-full text-left rounded-xl border border-border p-3" onClick={()=>void choose(m)}>{m.name} · 手機末四碼 {m.phoneSuffix||"未提供"}</button>)}
 {selected&&<div className="space-y-3 border-t border-border pt-3">
 <p>{selected.name}：{eligible===null?"尚未確認資格":eligible?"LINE 會員資格通過":"不符合抽獎資格"}</p>
 <label className="block">贈送次數<input className={field} type="number" min="1" max="100" step="1" value={qty} onChange={e=>setQty(e.target.value)}/></label>
 <label className="block">贈送原因<textarea className={field} maxLength={300} value={reason} onChange={e=>setReason(e.target.value)}/></label>
 <button type="button" disabled className="rounded-xl border border-border px-4 py-2 opacity-50">確認贈送（尚未開放）</button>
 </div>}
 </fieldset>
 <p role="status">{busy?"查詢中…":message}</p>
 </section>;
}

type LiveCampaign={id:string;name:string;version:number;status:"active"|"paused"|"ended"};
function CampaignControls({organizationId}:{organizationId:string}){
 const [campaign,setCampaign]=useState<LiveCampaign|null>(null);
 const [enabled,setEnabled]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 async function refresh(){
  setBusy(true);setLoaded(false);
  try{
   const r=await fetch("/api/staff/lucky-draw/campaign?"+new URLSearchParams({organizationId}),{cache:"no-store"});
   if(!r.ok)throw new Error();
   const data=await r.json();setCampaign(data.campaign);setEnabled(data.enabled===true);setLoaded(true);setMessage("");
  }catch{setMessage("無法讀取正式活動狀態");}finally{setBusy(false);}
 }
 useEffect(()=>{void refresh();},[organizationId]);
 async function act(action:string){
  if(!loaded||!enabled||busy)return;
  if(!window.confirm(action==="publish"?"確定發布最後儲存的草稿？":action==="end"?"確定結束活動？結束後不可恢復。":"確定變更活動狀態？"))return;
  setBusy(true);
  try{
   const r=await fetch("/api/staff/lucky-draw/campaign",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId,action,campaignId:campaign?.id,expected:campaign?.status})});
   if(!r.ok){const data=await r.json();throw new Error(String(data.code??"操作失敗"));}
   await refresh();
  }catch(e){setMessage(e instanceof Error?e.message:"操作失敗");}finally{setBusy(false);}
 }
 const button="rounded-xl border border-border px-4 py-2 disabled:opacity-50";
 return <section className="rounded-2xl border border-border bg-surface p-5 space-y-3">
 <h2 className="font-semibold">正式活動管理</h2>
 <p>{!loaded?"狀態尚未確認":campaign?campaign.name+" V"+campaign.version+" · "+({active:"啟用中",paused:"已暫停",ended:"已結束"}[campaign.status]):"尚未發布活動"}</p>
 <p className="text-sm text-secondary-text">{enabled?"發布前請先儲存草稿。":"正式發布功能尚未開放。"}</p>
 <div className="flex flex-wrap gap-2">
 {(!campaign||campaign.status==="ended")&&<button className={button} disabled={!loaded||!enabled||busy} onClick={()=>void act("publish")}>發布活動</button>}
 {campaign?.status==="paused"&&<button className={button} disabled={!enabled||busy||!loaded} onClick={()=>void act("activate")}>啟用／恢復活動</button>}
 {campaign?.status==="active"&&<button className={button} disabled={!enabled||busy||!loaded} onClick={()=>void act("pause")}>暫停活動</button>}
 {campaign&&campaign.status!=="ended"&&<button className={button} disabled={!enabled||busy||!loaded} onClick={()=>void act("end")}>結束活動</button>}
 <button className={button} disabled={busy} onClick={()=>void refresh()}>重新整理狀態</button>
 </div><p role="status">{message}</p>
 </section>;
}
