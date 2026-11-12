"use client";
import { useState } from "react";
export function ReturnLeaveRequests({locationId,requests,onReturned}:{locationId:string;requests:{id:string;staff_display_name:string;starts_at:string;status:string}[];onReturned:(ids:string[])=>void}) {
 const [chosen,setChosen]=useState<string[]>([]);
 const [note,setNote]=useState("");
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const pending=requests.filter(r=>r.status==="pending");
 const submit=async()=>{
  if(!chosen.length||note.trim().length<2||busy)return;
  if(!window.confirm("確定退回選取的 "+chosen.length+" 筆申請？"))return;
  setBusy(true);setMessage("");
  try{
   const response=await fetch("/api/staff/leave-requests/return",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId,requestIds:chosen,note:note.trim()})});
   const result=await response.json();
   if(!response.ok)throw new Error(result.error??"退回失敗");
   onReturned(chosen);setChosen([]);setNote("");
   setMessage("已退回 "+result.returned+" 筆申請。員工可重新選擇日期。");
  }catch(e){setMessage(e instanceof Error?e.message:"退回失敗");}
  finally{setBusy(false);}
 };
 return <section style={{border:"1px solid #e9dedf",borderRadius:14,padding:18,marginBottom:20}}>
  <h2 style={{fontWeight:650,fontSize:18}}>一鍵退回重排</h2>
  <p style={{fontSize:13,color:"#827578",margin:"8px 0 12px"}}>勾選需要修改的日期，一次退回員工重排。未勾選的申請維持待確認。</p>
  {pending.map(r=><label key={r.id} style={{display:"flex",gap:10,alignItems:"center",padding:"8px 0"}}>
   <input type="checkbox" checked={chosen.includes(r.id)} onChange={e=>setChosen(old=>e.target.checked?[...old,r.id]:old.filter(id=>id!==r.id))}/>
   <span>{new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Taipei",year:"numeric",month:"2-digit",day:"2-digit"}).format(new Date(r.starts_at))} · {r.staff_display_name}</span>
  </label>)}
  {pending.length===0&&<p>目前沒有待審核申請。</p>}
  <label htmlFor="return-note">退回原因（必填）</label>
  <textarea id="return-note" maxLength={500} value={note} onChange={e=>setNote(e.target.value)}
   placeholder="例如：當天人力不足，請改選其他日期" style={{display:"block",width:"100%",minHeight:72,padding:10,border:"1px solid #ddd",borderRadius:8}}/>
  <button type="button" disabled={!chosen.length||note.trim().length<2||busy} onClick={submit}
   style={{padding:"12px 18px",borderRadius:9,marginTop:12,background:"#985f73",color:"white",opacity:chosen.length&&note.trim().length>=2&&!busy?1:0.5}}>
   {busy?"處理中…":"退回選取的 "+chosen.length+" 筆申請"}
  </button>
  {message&&<p role="status" style={{marginTop:10}}>{message}</p>}
 </section>;
}
