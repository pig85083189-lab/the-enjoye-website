"use client";
import {useState} from "react";
type Customer={id:string;full_name:string;phone:string|null;customer_number:string|null};
export default function StaffFinanceLineBinding(){
 const [q,setQ]=useState("");
 const [rows,setRows]=useState<Customer[]>([]);
 const [selected,setSelected]=useState("");
 const [code,setCode]=useState("");
 const [message,setMessage]=useState("");
 const [busy,setBusy]=useState(false);
 async function search(){
  setBusy(true);setMessage("");setRows([]);setSelected("");
  try{const r=await fetch("/api/staff/line-finance-binding?q="+encodeURIComponent(q),{cache:"no-store"});
   const d=await r.json();if(!r.ok)throw Error(d.code??"SEARCH_FAILED");
   setRows(d.customers??[]);if(!(d.customers??[]).length)setMessage("查無顧客，請確認姓名或電話。");
  }catch{setMessage("無法查詢顧客，請確認登入權限。");}finally{setBusy(false);}
 }
 async function confirm(){
  if(!selected||!/^[0-9a-f]{16}$/i.test(code.trim())){setMessage("請先選擇顧客，並輸入 16 碼 LINE 代碼。");return;}
  if(!window.confirm("已當面核對顧客身分及 LINE 會員代碼，確認將此 LINE 帳號連結到選定的原有顧客？"))return;
  setBusy(true);setMessage("");
  try{const r=await fetch("/api/staff/line-finance-binding",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({customerId:selected,code:code.trim()})});
   const d=await r.json();setMessage(r.ok?"綁定成功。會員重新整理後即可查看經授權的原有資料。":"綁定未完成："+(d.outcome??d.code??"UNKNOWN"));
   if(r.ok){setCode("");setSelected("");setRows([]);}
  }catch{setMessage("連線失敗，未完成綁定。");}finally{setBusy(false);}
 }
 return <main style={{maxWidth:720,margin:"32px auto",padding:24}}>
  <h1>LINE 會員顧客綁定</h1>
  <p>僅供主管使用。請先當面核對顧客身分，再選擇 Beauty OS 原有顧客，輸入顧客 LINE 會員中心顯示的 16 碼代碼。不能只依姓名或電話自動綁定。</p>
  <label htmlFor="customer-search">搜尋原有顧客（姓名或電話）</label>
  <div style={{display:"flex",gap:8,margin:"8px 0 20px"}}>
   <input id="customer-search" value={q} onChange={e=>setQ(e.target.value)} style={{flex:1,padding:10}} placeholder="至少 2 個字"/>
   <button type="button" disabled={busy||q.trim().length<2} onClick={search}>搜尋</button>
  </div>
  {rows.length>0&&<fieldset style={{padding:16,marginBottom:20}}><legend>選擇已當面確認的顧客</legend>
   {rows.map(c=><label key={c.id} style={{display:"block",padding:8}}>
    <input type="radio" name="customer" checked={selected===c.id} onChange={()=>setSelected(c.id)}/>
    {" "+c.full_name+" · "+(c.phone??"無電話")+" · "+(c.customer_number??"")}
   </label>)}
  </fieldset>}
  <label htmlFor="line-code">顧客出示的 16 碼 LINE 連結代碼</label>
  <input id="line-code" value={code} onChange={e=>setCode(e.target.value.toUpperCase().replace(/[^0-9A-F]/g,"").slice(0,16))}
   autoComplete="off" maxLength={16} style={{display:"block",width:"100%",maxWidth:320,padding:12,margin:"8px 0 16px",letterSpacing:2}}/>
  <button type="button" disabled={busy||!selected||code.length!==16} onClick={confirm} style={{padding:"12px 20px"}}>核對完成，確認綁定</button>
  {message&&<p role="status">{message}</p>}
 </main>;
}
