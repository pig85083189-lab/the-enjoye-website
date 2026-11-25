"use client";
import {useEffect,useState} from "react";
import {Card} from "@/components/ui/Card";
export function MemberPointsSettings({organizationId}:{organizationId:string}){
 const [enabled,setEnabled]=useState(false),[amount,setAmount]=useState("100"),[ready,setReady]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 useEffect(()=>{
 const controller=new AbortController();
 setReady(false);setMessage("");
 fetch("/api/staff/member-points/settings?organizationId="+encodeURIComponent(organizationId),{cache:"no-store",signal:controller.signal}).then(async r=>{if(!r.ok)throw new Error();return r.json();}).then(d=>{if(!controller.signal.aborted){setEnabled(d.enabled===true);setAmount(String(d.spend_per_point));setReady(true);}}).catch(()=>{if(!controller.signal.aborted)setMessage("目前無法讀取點數設定");});
 return ()=>controller.abort();
 },[organizationId]);
 const valid=Number.isSafeInteger(Number(amount))&&Number(amount)>=1&&Number(amount)<=1000000;
 async function save(){
 if(!ready||busy||!valid)return;
 setBusy(true);setMessage("");
 try{const r=await fetch("/api/staff/member-points/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId,enabled,spendPerPoint:Number(amount)})});if(!r.ok)throw new Error();const d=await r.json();setEnabled(d.enabled===true);setAmount(String(d.spend_per_point));setMessage("點數設定已儲存");}catch{setMessage("儲存失敗，請稍後再試");}finally{setBusy(false);}
 }
 return <Card padding="lg" className="mt-4 min-w-0 space-y-4 shadow-none"><h2 className="text-[16px] font-semibold text-text">會員點數設定</h2><p className="text-sm text-secondary-text">符合資格的 LINE 會員消費後自動累積點數。</p><label className="flex items-center gap-3"><input type="checkbox" checked={enabled} disabled={!ready||busy} onChange={e=>setEnabled(e.target.checked)}/>啟用消費累積點數</label><label className="flex flex-wrap items-center gap-2">每消費 NT$ <input aria-label="每點消費金額" className="w-28 rounded-xl border border-border bg-surface p-2" type="number" min={1} max={1000000} step={1} value={amount} disabled={!ready||busy} onChange={e=>setAmount(e.target.value)}/> 累積 1 點</label><p className="text-sm text-secondary-text">消費 NT$ 1,800 可累積 {enabled&&valid?Math.floor(1800/Number(amount)):0} 點。停用不會清除既有點數。</p><button type="button" disabled={!ready||busy||!valid} onClick={save} className="rounded-xl bg-primary px-4 py-2 text-white disabled:opacity-50">{busy?"儲存中":"儲存點數設定"}</button><p role="status" className="text-sm text-secondary-text">{message}</p></Card>;
}
