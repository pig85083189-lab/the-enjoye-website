"use client";
import {useEffect,useState,useCallback} from "react";
type Slide={image_url:string;href:string;enabled:boolean};
type Banner={slides:Slide[];enabled:boolean};
const defaultBanner:Banner={slides:[],enabled:true};
type Gift={ticket_color?:string;ticket_icon?:string;ticket_image_url?:string|null;id:string;name:string;description:string;image_url:string|null;points_cost:number;stock:number;active:boolean};
type Redemption={id:string;gift_name:string;points_cost:number;status:string;created_at:string};
const endpoint="/api/staff/member-points/gifts";
const field="min-h-11 w-full rounded-xl border border-border bg-surface px-3 py-2 text-text";
const button="min-h-11 rounded-xl border border-border px-4 py-2 disabled:opacity-50";
async function prepareGiftImage(file:File):Promise<File>{
 if(!["image/jpeg","image/png","image/webp"].includes(file.type))throw new Error("請選擇 JPG、PNG 或 WebP 圖片");
 if(file.size<=1400000)return file;
 const bitmap=await createImageBitmap(file);
 try{const canvas=document.createElement("canvas");const scale=Math.min(1,1600/Math.max(bitmap.width,bitmap.height));canvas.width=Math.max(1,Math.round(bitmap.width*scale));canvas.height=Math.max(1,Math.round(bitmap.height*scale));const ctx=canvas.getContext("2d");if(!ctx)throw new Error("無法處理圖片");ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);for(const quality of [0.85,0.7,0.5,0.3]){const blob=await new Promise<Blob|null>(resolve=>canvas.toBlob(resolve,"image/webp",quality));if(blob&&blob.size<=1400000&&blob.type==="image/webp")return new File([blob],"gift.webp",{type:blob.type});}throw new Error("圖片仍過大，請選擇較小的圖片");}finally{bitmap.close();}
}
export function MemberGiftSettings({organizationId}:{organizationId:string}){
 const [banner,setBanner]=useState<Banner>(defaultBanner);
 const [data,setData]=useState<{gifts:Gift[];redemptions:Redemption[];prizes?:{id:string;name:string;tier:string;ticket_color:string;ticket_icon:string;ticket_image_url:string|null}[];draws?:{id:string;prize_name:string;prize_tier:string;voucher_status:string;created_at:string}[]}|null>(null);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [ticket,setTicket]=useState<{id:string;color:string;icon:string;image:string;draw?:boolean}|null>(null);
 const [editing,setEditing]=useState<string|null>(null);
 const [name,setName]=useState(""),[description,setDescription]=useState(""),[image,setImage]=useState(""),[points,setPoints]=useState("100"),[stock,setStock]=useState("0");
 const load=useCallback(async()=>{const r=await fetch(endpoint+"?organizationId="+encodeURIComponent(organizationId),{cache:"no-store"});if(!r.ok)throw new Error("READ");const v=await r.json();setData(v);setBanner(v.banner?{enabled:v.banner.enabled,slides:v.banner.slides??(v.banner.image_url?[{image_url:v.banner.image_url,href:'',enabled:true}]:[])}:defaultBanner);},[organizationId]);
 useEffect(()=>{load().catch(()=>setMessage("目前無法讀取禮品管理"));},[load]);
 async function send(payload:Record<string,unknown>){
 if(busy)return false;setBusy(true);setMessage("");
 try{const r=await fetch(endpoint,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({...payload,organizationId})});if(!r.ok)throw new Error("SAVE");await load();setMessage("操作完成");return true;}catch{setMessage("操作結果未確認，請重新整理確認紀錄");return false;}finally{setBusy(false);}
 }
 return <section className="mt-4 space-y-4 rounded-2xl border border-border bg-surface p-4">
 <h2 className="text-base font-semibold">點數禮品管理</h2>
 <p className="text-sm text-secondary-text">新增禮品後須手動上架，會員才可兌換。</p>
 {message&&<p role="status">{message}</p>}
 <section className="space-y-3 rounded-xl border border-border p-3">
 <h3 className="font-semibold">商城輪播橫幅設定</h3>
 <fieldset disabled={busy||!data} className="space-y-3">
 <p>最多 10 張，建議使用相同比例圖片。</p>
 {banner.slides.map((s,i)=><article key={i} className="rounded-xl border border-border p-3 space-y-2">
 <strong>橫幅圖片 {i+1}</strong><img src={s.image_url} alt="橫幅預覽" className="w-full rounded-xl object-contain" style={{maxHeight:240}}/>
 <label>圖片跳轉連結<input className={field} maxLength={2048} placeholder="#catalog 或 https://..." value={s.href} onChange={e=>setBanner(b=>({...b,slides:b.slides.map((x,j)=>j===i?{...x,href:e.target.value}:x)}))}/></label>
 <label><input type="checkbox" checked={s.enabled} onChange={e=>setBanner(b=>({...b,slides:b.slides.map((x,j)=>j===i?{...x,enabled:e.target.checked}:x)}))}/> 啟用此圖片</label>
 <div className="flex gap-2">{[-1,1].map(d=><button key={d} type="button" className={button} disabled={i+d<0||i+d>=banner.slides.length} onClick={()=>setBanner(b=>{const slides=[...b.slides];[slides[i],slides[i+d]]=[slides[i+d],slides[i]];return {...b,slides};})}>{d<0?"上移":"下移"}</button>)}<button type="button" className={button} onClick={()=>setBanner(b=>({...b,slides:b.slides.filter((_,j)=>j!==i)}))}>移除</button></div>
 </article>)}
 <label>新增輪播圖片<input className={field} type="file" accept="image/jpeg,image/png,image/webp" disabled={banner.slides.length>=10} onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file||busy)return;setBusy(true);try{const form=new FormData();form.set("organizationId",organizationId);form.set("image",await prepareGiftImage(file));const r=await fetch(endpoint+"/image",{method:"POST",body:form});if(!r.ok)throw Error("圖片上傳失敗（HTTP "+r.status+"）");const v=await r.json();if(typeof v.url!=="string")throw Error("圖片網址錯誤");setBanner(b=>({...b,slides:[...b.slides,{image_url:v.url,href:"",enabled:true}]}));setMessage("圖片已上傳，請儲存輪播設定");}catch(error){setMessage(error instanceof Error?error.message:"上傳失敗");}finally{setBusy(false);}}}/></label>
 <label><input type="checkbox" checked={banner.enabled} onChange={e=>setBanner(b=>({...b,enabled:e.target.checked}))}/> 啟用輪播</label>
 <button type="button" className={button} onClick={()=>void send({action:"carousel",...banner})}>儲存輪播設定</button>
 </fieldset>
 </section>
 <form className="grid gap-3 sm:grid-cols-2" onSubmit={async e=>{e.preventDefault();if(await send({action:editing?"edit":"create",id:editing,name,description,image,points:Number(points),stock:Number(stock)})){setEditing(null);setName("");setDescription("");setImage("");setStock("0");}}}>
 <label>禮品名稱<input className={field} required maxLength={120} value={name} onChange={e=>setName(e.target.value)}/></label>
 <div className="space-y-2"><label>禮品圖片<input className={field} type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||!data} onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file||busy)return;setBusy(true);try{const form=new FormData();form.set("organizationId",organizationId);form.set("image",await prepareGiftImage(file));const r=await fetch(endpoint+"/image",{method:"POST",body:form});if(!r.ok)throw new Error("圖片上傳失敗（HTTP "+r.status+"）");const v=await r.json();if(typeof v.url!=="string")throw new Error("URL");setImage(v.url);setMessage("圖片已上傳，請儲存禮品");}catch(error){setMessage(error instanceof Error?error.message:"圖片上傳失敗");}finally{setBusy(false);}}}/></label>{image&&<img src={image} alt="禮品預覽" className="h-28 w-28 rounded-xl object-cover" referrerPolicy="no-referrer"/>}<button type="button" className={button} disabled={busy||!image} onClick={()=>setImage("")}>移除圖片</button></div>
 <label className="sm:col-span-2">禮品介紹<textarea className={field} maxLength={2000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
 <label>兌換點數<input className={field} type="number" min={1} max={1000000} required value={points} onChange={e=>setPoints(e.target.value)}/></label>
 <label>{editing?"庫存（請使用下方調整功能）":"庫存"}<input disabled={!!editing} className={field} type="number" min={0} max={1000000} required value={stock} onChange={e=>setStock(e.target.value)}/></label>
 <button className={button} disabled={busy||!data}>{editing?"儲存修改":"新增禮品"}</button>{editing&&<button type="button" className={button} onClick={()=>{setEditing(null);setName("");setDescription("");setImage("");setStock("0");}}>取消編輯</button>}
 </form>
 <h3 className="font-semibold">禮品列表</h3>
 {ticket&&<fieldset disabled={busy} className="space-y-3 rounded-xl border border-border p-3">
 <h4>電子票券外觀設定</h4>
 <label>票券配色<select className={field} value={ticket.color} onChange={e=>setTicket(t=>t?{...t,color:e.target.value}:t)}><option value="gold">奶茶金</option><option value="rose">玫瑰粉</option><option value="sage">鼠尾草綠</option><option value="lavender">淡紫色</option></select></label>
 <label>預設圖示<select className={field} value={ticket.icon} onChange={e=>setTicket(t=>t?{...t,icon:e.target.value}:t)}><option value="gift">禮盒</option><option value="aroma">芳療</option><option value="facial">臉部保養</option><option value="lotus">蓮花</option></select></label>
 {ticket.image&&<img src={ticket.image} alt="票券圖案預覽" className="h-24 w-24 object-contain"/>}
 <label>上傳專屬圖案<input className={field} type="file" accept="image/jpeg,image/png,image/webp" onChange={async e=>{const file=e.target.files?.[0];e.target.value="";if(!file||busy)return;setBusy(true);try{const form=new FormData();form.set("organizationId",organizationId);form.set("image",await prepareGiftImage(file));const r=await fetch(endpoint+"/image",{method:"POST",body:form});if(!r.ok)throw Error("圖片上傳失敗");const v=await r.json();if(typeof v.url!=="string")throw Error("圖片網址錯誤");setTicket(t=>t?{...t,image:v.url}:t);}catch(error){setMessage(error instanceof Error?error.message:"上傳失敗");}finally{setBusy(false);}}}/></label>
 <button type="button" className={button} onClick={()=>setTicket(t=>t?{...t,image:""}:t)}>使用預設圖示</button>
 <button type="button" className={button} onClick={async()=>{if(await send({action:ticket.draw?"draw_style":"ticket_style",...ticket}))setTicket(null)}}>儲存票券外觀</button>
 <button type="button" className={button} onClick={()=>setTicket(null)}>取消</button>
 </fieldset>}
 {data?.gifts.map(g=><article key={g.id} className="rounded-xl border border-border p-3 space-y-2"><strong>{g.name}</strong><p>{g.points_cost} 點 · 庫存 {g.stock} · {g.active?"已上架":"未上架"}</p><button className={button} disabled={busy} onClick={()=>{setEditing(g.id);setName(g.name);setDescription(g.description);setImage(g.image_url??"");setPoints(String(g.points_cost));setStock(String(g.stock));}}>編輯禮品</button><button type="button" className={button} disabled={busy} onClick={()=>setTicket({id:g.id,color:g.ticket_color??"gold",icon:g.ticket_icon??"gift",image:g.ticket_image_url??""})}>電子票券外觀設定</button><button className={button} disabled={busy} onClick={()=>{const raw=window.prompt("輸入庫存增減數量，例如 5 或 -2");if(raw===null)return;const delta=Number(raw);if(!Number.isSafeInteger(delta)||!delta){setMessage("請輸入非零整數");return;}if(window.confirm("確認調整庫存 "+delta+" 件？"))void send({action:"stock",id:g.id,delta});}}>調整庫存</button><button className={button} disabled={busy} onClick={()=>{if(window.confirm(g.active?"確定下架？":"確定上架？"))void send({action:"publish",id:g.id,active:!g.active});}}>{g.active?"下架":"上架"}</button></article>)}
 <h3 className="font-semibold">抽獎票券外觀</h3>
 {data?.prizes?.map(p=><article key={p.id} className="rounded-xl border border-border p-3"><strong>{p.tier}・{p.name}</strong><button className={button} disabled={busy} onClick={()=>{setTicket({id:p.id,color:p.ticket_color,icon:p.ticket_icon,image:p.ticket_image_url??"",draw:true});}}>電子票券外觀設定</button></article>)}
 <h3 className="font-semibold">抽獎票券核銷</h3>
 {data?.draws?.map(r=><article key={r.id} className="rounded-xl border border-border p-3 space-y-2"><strong>{r.prize_tier}・{r.prize_name}</strong><p>{r.voucher_status==="issued"?"待核銷":r.voucher_status==="used"?"已核銷":"已取消"}</p><p className="break-all text-xs">券號：{r.id}</p>{r.voucher_status==="issued"&&<button className={button} disabled={busy} onClick={()=>{if(window.confirm("確認會員出示的券號及獎品已交付？"))void send({action:"draw_resolve",id:r.id,status:"used"});}}>確認核銷</button>}</article>)}
 <h3 className="font-semibold">會員兌換紀錄</h3>
 {data?.redemptions.map(r=><article key={r.id} className="rounded-xl border border-border p-3 space-y-2"><strong>{r.gift_name}</strong><p>{r.points_cost} 點 · {r.status==="issued"?"待核銷":r.status==="used"?"已核銷":"已取消"}</p><p className="break-all text-xs">券號：{r.id}</p>{r.status==="issued"&&<div className="flex flex-wrap gap-2"><button className={button} disabled={busy} onClick={()=>{if(window.confirm("確認會員出示的券號及禮品已交付？"))void send({action:"resolve",id:r.id,status:"used"});}}>確認核銷</button><button className={button} disabled={busy} onClick={()=>{if(window.confirm("取消兌換並退回點數及庫存？"))void send({action:"resolve",id:r.id,status:"cancelled"});}}>取消退點</button></div>}</article>)}
 </section>;
}
