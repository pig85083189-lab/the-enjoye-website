"use client";
import {useEffect,useState} from "react";
import {Card} from "@/components/ui/Card";
type Voucher={id:string;source:string;name:string;tier:string|null;status:string;createdAt:string;resolvedAt:string|null};
const labels:Record<string,string>={issued:"待使用",used:"已核銷",cancelled:"已取消",canceled:"已取消"};
export function VouchersTab({organizationId,customerId,historyOnly=false}:{organizationId:string;customerId:string;historyOnly?:boolean}){
 const [state,setState]=useState<{loading:boolean;error:string;rows:Voucher[]}>({loading:true,error:"",rows:[]});
 useEffect(()=>{
 const controller=new AbortController();
 setState({loading:true,error:"",rows:[]});
 const params=new URLSearchParams({organizationId,customerId});
 fetch("/api/staff/customers/vouchers?"+params,{cache:"no-store",signal:controller.signal}).then(async r=>{
 const data=await r.json();
 if(!r.ok)throw new Error(data.code==="LINE_LINK_REQUIRED"?"此客戶尚未完成 LINE 會員綁定":"無法讀取票券資料");
 if(!controller.signal.aborted)setState({loading:false,error:"",rows:data.vouchers??[]});
 }).catch(e=>{if(!controller.signal.aborted)setState({loading:false,error:e.message,rows:[]});});
 return ()=>controller.abort();
 },[organizationId,customerId]);
 const rows=historyOnly?state.rows.filter(v=>v.status==="used"):state.rows;
 return <Card><div className="space-y-3 p-4"><h3 className="font-semibold">{historyOnly?"票券核銷紀錄":"客戶票券"}</h3>
 {state.loading?<p>讀取中…</p>:state.error?<p role="alert">{state.error}</p>:!rows.length?<p className="text-sm text-secondary-text">目前沒有票券紀錄</p>:<>
 {!historyOnly&&<div className="flex flex-wrap gap-4 text-sm">待使用 {rows.filter(v=>v.status==="issued").length} 張　已核銷 {rows.filter(v=>v.status==="used").length} 張　已取消 {rows.filter(v=>["cancelled","canceled"].includes(v.status)).length} 張</div>}
 {rows.map(v=><div key={v.source+":"+v.id} className="rounded-lg border border-border p-3"><div className="flex flex-wrap justify-between gap-2"><strong>{v.name}</strong><span className="text-sm">{labels[v.status]??v.status}</span></div><p className="text-sm text-secondary-text">{v.source==="draw"?"抽獎獲得":"點數兌換"}{v.tier?" · "+v.tier:""}</p><p className="text-xs">取得：{new Date(v.createdAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}</p>{v.resolvedAt&&<p className="text-xs">處理時間：{new Date(v.resolvedAt).toLocaleString("zh-TW",{timeZone:"Asia/Taipei"})}</p>}</div>)}</>}
 </div></Card>;
}
