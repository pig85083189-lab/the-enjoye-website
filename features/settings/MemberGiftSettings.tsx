"use client";
import {useEffect,useState,useCallback} from "react";
type Gift={id:string;name:string;description:string;image_url:string|null;points_cost:number;stock:number;active:boolean};
type Redemption={id:string;gift_name:string;points_cost:number;status:string;created_at:string};
const endpoint="/api/staff/member-points/gifts";
const field="min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-text";
const button="min-h-11 rounded-xl border border-border px-4 py-2 disabled:opacity-50";
export function MemberGiftSettings({organizationId}:{organizationId:string}){
 const [data,setData]=useState<{gifts:Gift[];redemptions:Redemption[]}|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [name,setName]=useState(""),[description,setDescription]=useState(""),[image,setImage]=useState(""),[points,setPoints]=useState("100"),[stock,setStock]=useState("0");
 const load=useCallback(async()=>{const r=await fetch(endpoint+"?organizationId="+encodeURIComponent(organizationId),{cache:"no-store"});if(!r.ok)throw new Error("READ");setData(await r.json());},[organizationId]);
 useEffect(()=>{load().catch(()=>setMessage("目前無法讀取禮品管理"));},[load]);
 async function send(payload:Record<string,unknown>){
 if(busy)return false;setBusy(true);setMessage("");
 try{const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,organizationId})});if(!r.ok)throw new Error("SAVE");await load();setMessage("操作完成");return true;}catch{setMessage("操作結果未確認，請重新整理確認紀錄");return false;}finally{setBusy(false);}
 }
 return <section className="mt-4 space-y-4 rounded-2xl border border-border bg-surface p-4">
 <h2 className="text-base font-semibold">點數禮品管理</h2>
 <p className="text-sm text-secondary-text">新增禮品後須手動上架，會員才可兌換。</p>
 {message&&<p role="status">{message}</p>}
 <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();if(await send({action:"create",name,description,image,points:Number(points),stock:Number(stock)})){setName("");setDescription("");setImage("");setStock("0");}}}>
 <label>禮品名稱<input className={field} required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
 <label>圖片 HTTPS 網址<input className={field} type="url" value={image} onChange={e=>setImage(e.target.value)}/></label>
 <label className="sm:col-span-2">禮品介紹<textarea className={field} maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <label>兌換點數<input className={field} type="number" min={1} max={1000000} required value={points} onChange={e=>setPoints(e.target.value)}/></label>
 <label>庫存<input className={field} type="number" min={0} max={1000000} required value={stock} onChange={e=>setStock(e.target.value)}/></label>
 <button className={button} disabled={busy||!data}>新增禮品</button>
 </form>
 <h3 className="font-semibold">禮品列表</h3>
 {data?.gifts.map(g=><article key={g.id} className="rounded-xl border border-border p-3 space-y-2"><strong>{g.name}</strong><p>{g.points_cost} 點 · 庫存 {g.stock} · {g.active?"已上架":"未上架"}</p><button className={button} disabled={busy} onClick={()=>{if(window.confirm(g.active?"確定下架？":"確定上架？"))void send({action:"publish",id:g.id,active:!g.active});}}>{g.active?"下架":"上架"}</button></article>)}
 <h3 className="font-semibold">會員兌換紀錄</h3>
 {data?.redemptions.map(r=><article key={r.id} className="rounded-xl border border-border p-3 space-y-2"><strong>{r.gift_name}</strong><p>{r.points_cost} 點 · {r.status==="issued"?"待核銷":r.status==="used"?"已核銷":"已取消"}</p><p className="break-all text-xs">券號：{r.id}</p>{r.status==="issued"&&<div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{if(window.confirm("確認會員出示的券號及禮品已交付？"))void send({action:"resolve",id:r.id,status:"used"});}}>確認核銷</button><button className={button} disabled={busy} onClick={()=>{if(window.confirm("取消兌換並退回點數及庫存？"))void send({action:"resolve",id:r.id,status:"cancelled"});}}>取消退點</button></div>}</article>)}
 </section>;
}
