"use client";

import { useState } from "react";
import { previewMemberTreatmentPublication,publishMemberTreatment,revokeMemberTreatment } from "./member-publication-actions";

type PublicFields=Record<string,string|string[]|number|boolean|Array<{label:string;value:string}>|Array<{area:string;conditions:string[];note:string|null}>>;
const labels:Record<string,string>={
 consultation_answers:"新版諮詢評估／專業紀錄",body_marker_details:"身體部位標記詳情",staff_name:"服務美容師",concerns:"身體狀況／症狀",client_focus:"本次保養重點",
 comparison_to_last:"與上次保養比較",sensitivity_level:"敏感程度",body_markers:"身體部位標記",
 body_map_note:"身體部位補充說明",discomfort_note:"不適狀況備註",client_feeling:"顧客療程感受",
 products:"使用產品紀錄",follow_up_note:"保養後建議",follow_up_tags:"追蹤標籤",
 suggest_next_booking:"是否建議下次預約",suggested_date:"建議下次保養日期",
 suggested_tracking_areas:"建議追蹤部位"
};
export function MemberPublicationPanel({organizationId,treatmentId}:{organizationId:string;treatmentId:string}){
 const [preview,setPreview]=useState<PublicFields|null>(null);
 const [selected,setSelected]=useState<string[]>([]);
 const [published,setPublished]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [loaded,setLoaded]=useState(false);
 async function load(){
  setBusy(true);setError("");
  try{const r=await previewMemberTreatmentPublication(organizationId,treatmentId);
   setPreview(r.fields);setSelected(Object.keys(r.fields));setPublished(r.status==="published");setLoaded(true);
  }catch(e){setError(e instanceof Error?e.message:"無法預覽");}finally{setBusy(false);}
 }
 async function submit(revoke:boolean){
  if(!revoke&&!window.confirm("確定將勾選內容公開至此顧客的會員身體紀錄？"))return;
  if(revoke&&!window.confirm("確定撤銷會員可見的療程內容？"))return;
  setBusy(true);setError("");
  try{
   if(revoke)await revokeMemberTreatment(organizationId,treatmentId);
   else await publishMemberTreatment(organizationId,treatmentId,Object.fromEntries(Object.entries(preview??{}).filter(([key])=>selected.includes(key))));
   await load();
  }catch(e){setError(e instanceof Error?e.message:"操作失敗");}finally{setBusy(false);}
 }
 return <section className="rounded-2xl border border-[#E9D7D4] bg-white p-5">
  <h2 className="text-base font-semibold text-text">公開至會員身體紀錄</h2>
  <p className="mt-2 text-sm text-secondary-text">僅主管或店長可操作。公開前請逐項確認內容適合顧客閱讀，未勾選的項目不會顯示。</p>
  {!loaded?<button type="button" disabled={busy} onClick={load} className="mt-4 rounded-xl bg-[#B77C7E] px-4 py-3 text-sm text-white disabled:opacity-50">{busy?"讀取中…":"檢查公開狀態與預覽"}</button>:<>
   <p className="mt-3 text-sm font-medium">{published?"已公開，可修改或撤銷":"尚未公開"}</p>
   <div className="mt-4 space-y-3">{Object.entries(preview??{}).map(([key,value])=><label key={key} className="flex items-start gap-3 rounded-xl border border-[#F0E5E3] p-3 text-sm">
    <input type="checkbox" className="mt-1" checked={selected.includes(key)} onChange={e=>setSelected(prev=>e.target.checked?[...prev,key]:prev.filter(v=>v!==key))}/>
    <span className="min-w-0"><strong>{labels[key]??key}</strong><span className="mt-1 block whitespace-pre-wrap break-words text-secondary-text">{Array.isArray(value)?value.map(item=>typeof item==="string"?item:("label" in item?`${item.label}：${item.value}`:`${item.area}：${item.conditions.join("、")}${item.note?`（${item.note}）`:""}`)).join("、"):typeof value==="boolean"?(value?"是":"否"):String(value)}</span></span>
   </label>)}</div>
   <div className="mt-4 flex flex-wrap gap-3">
    <button type="button" disabled={busy||selected.length===0} onClick={()=>submit(false)} className="rounded-xl bg-[#B77C7E] px-4 py-3 text-sm text-white disabled:opacity-50">{busy?"處理中…":published?"更新公開內容":"確認公開至會員"}</button>
    {published&&<button type="button" disabled={busy} onClick={()=>submit(true)} className="rounded-xl border border-[#B77C7E] px-4 py-3 text-sm text-[#9A5D61] disabled:opacity-50">撤銷公開</button>}
   </div>
  </>}
  {error&&<p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
  <p className="mt-3 text-xs text-secondary-text">內部專業備註、操作內容及療程照片永不包含在此公開清單。</p>
 </section>;
}
