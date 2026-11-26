"use client";
import {useEffect,useState} from "react";
export type Ticket={id:string;name:string;source:string;tier?:string};
export default function CheckoutVoucherList({organizationId,draftId,selected,onToggle,disabled}:{organizationId:string;draftId:string;selected:string[];onToggle:(key:string)=>void;disabled:boolean}){
 const [result,setResult]=useState<{key:string;tickets:Ticket[];error:string}|null>(null);
 const key=JSON.stringify([organizationId,draftId]);
 useEffect(()=>{if(!draftId)return;const controller=new AbortController();const params=new URLSearchParams({organizationId,draftId});fetch("/api/staff/commerce/vouchers?"+params,{cache:"no-store",signal:controller.signal}).then(async r=>{if(!r.ok)throw Error("目前無法確認會員票券");const data=await r.json();if(!Array.isArray(data.tickets))throw Error("票券資料異常");if(!controller.signal.aborted)setResult({key,tickets:data.tickets,error:""});}).catch(e=>{if(!controller.signal.aborted)setResult({key,tickets:[],error:e.message});});return()=>controller.abort();},[organizationId,draftId,key]);
 const current=result?.key===key?result:null;
 return <div className="space-y-3"><div className="rounded-xl border border-border px-3 py-2.5"><p className="font-medium">電子票券核銷</p><p className="text-[12px] text-secondary-text">請勾選本次欲使用的票券，完成結帳後將核銷。</p></div>{!draftId?<p>尚未建立結帳資料。</p>:!current?<p>讀取票券中…</p>:current.error?<p role="alert">{current.error}</p>:current.tickets.length===0?<p>目前沒有待使用票券。</p>:current.tickets.map(t=><label key={t.source+":"+t.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2.5"><input type="checkbox" disabled={disabled} checked={selected.includes(t.source+":"+t.id)} onChange={()=>onToggle(t.source+":"+t.id)}/><span className="flex-1"><p className="font-medium">{t.name}</p><p className="text-[12px] text-secondary-text">{t.source==="draw"?"抽獎中獎・"+(t.tier??""):"點數兌換好禮"} · 待使用</p></span></label>)}</div>;
}
