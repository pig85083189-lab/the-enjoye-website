"use client";
import {useEffect,useState} from "react";
import {Card} from "@/components/ui/Card";
type Audit={source:string;voucher_id:string;checkout_app_id:string;redeemed_at:string;actor_auth_user_id?:string|null};
type Voucher={id:string;source:string;name:string;tier:string|null;status:string;createdAt:string;resolvedAt:string|null};
const labels:Record<string,string>={issued:"待使用",used:"已核銷",cancelled:"已取消",canceled:"已取消"};
export function VouchersTab({organizationId,customerId,historyOnly=false}:{organizationId:string;customerId:string;historyOnly?:boolean}){
 const [revision,setRevision]=useState(0);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState("");
 const [canRedeem,setCanRedeem]=useState(false);
 const [audit,setAudit]=useState<Audit[]>([]);
 const [state,setState]=useState<{loading:boolean;error:string;rows:Voucher[]}>({loading:true,error:"",rows:[]});
 useEffect(()=>{
 const controller=new AbortController();
 setState({loading:true,error:"",rows:[]});
 const params=new URLSearchParams({organizationId,customerId});
 fetch("/api/staff/customers/vouchers?"+params,{cache:"no-store",signal:controller.signal}).then(async r=>{
 const data=await r.json();
 if(!r.ok)throw new Error(data.code==="LINE_LINK_REQUIRED"?"此客戶尚未完成 LINE 會員綁定":"無法讀取票券資料");
 if(!controller.signal.aborted){setState({loading:false,error:"",rows:data.vouchers??[]});setAudit(data.redemptions??[]);setCanRedeem(data.canRedeem===true);}
 }).catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e.message,rows:[]});});
 return ()=>controller.abort();
 },[organizationId,customerId,revision]);
 async function redeem(v:Voucher){if(busy||!window.confirm("確定核銷「"+v.name+"」？核銷後不可重複使用。"))return;setBusy(true);setMessage("");try{const r=await fetch("/api/staff/customers/vouchers",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId,customerId,ticket:v.source+":"+v.id})});if(!r.ok)throw new Error("核銷未確認，請重新查詢票券狀態。");setMessage("核銷成功");}catch(e){setMessage(e instanceof Error?e.message:"核銷未確認");}finally{setRevision(n=>n+1);setBusy(false);}}

 const rows=historyOnly?state.rows.filter(v=>v.status==="used"):state.rows;
 return <Card><div className="space-y-3 p-4"><h3 className="font-semibold">{historyOnly?"票券核銷紀錄":"客戶票券"}</h3>
 {message&&<p role="status" className="text-sm">{message}</p>}{state.loading?<p>讀取中…</p>:state.error?<p role="alert">{state.error}</p>:!rows.length?<p className="text-sm text-secondary-text">目前沒有票券紀錄</p>:<>
 {!historyOnly&&<div className="flex flex-wrap gap-4 text-sm">待使用 {rows.filter(v=>v.status==="issued").length} 張　已核銷 {rows.filter(v=>v.status==="used").length} 張　已取消 {rows.filter(v=>["cancelled","canceled"].includes(v.status)).length} 張</div>}
 {rows.map(v=><div key={v.source+":"+v.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{v.name}</strong><span className="text-sm">{labels[v.status]??v.status}</span></div><p className="text-sm text-secondary-text">{v.source==="draw"?"抽獎獲得":"點數兌換"}{v.tier?" · "+v.tier:""}</p><p className="text-xs">取得：{new Date(v.createdAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}</p>{v.resolvedAt&&<p className="text-xs">處理時間：{new Date(v.resolvedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}</p>}{v.status==="used"&&<p className="text-xs">{(()=>{const a=audit.find(a=>a.source===v.source&&a.voucher_id===v.id);return a?(a.checkout_app_id.startsWith("manual:")?"後台手動核銷":"結帳核銷"):"既有核銷紀錄（方式未記錄）";})()}</p>}{!historyOnly&&canRedeem&&v.status==="issued"&&<button type="button" disabled={busy} className="mt-2 rounded-md border border-border px-3 py-2 text-sm disabled:opacity-50" onClick={()=>void redeem(v)}>手動核銷</button>}</div>)}</>}
 </div></Card>;
}
