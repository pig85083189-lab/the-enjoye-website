"use client";
import {useEffect,useState} from "react";
const defaults={enabled:false,name:"",asset:"",effect:"none",opacity:80,speed:2,start:"",end:""};
const effects=[["none","無"],["snow","雪花"],["red","紅包"],["gold","金幣"],["flower","櫻花"],["heart","愛心"],["birthday","彩帶"],["star","星光"]];
export function MemberHomeThemeSettings({organizationId}:{organizationId:string}){
const [p,setP]=useState(defaults),[busy,setBusy]=useState(true),[loaded,setLoaded]=useState(false),[msg,setMsg]=useState("");
const api="/api/staff/member-home-theme";
useEffect(()=>{let live=true;setBusy(true);setLoaded(false);fetch(api+"?organizationId="+encodeURIComponent(organizationId),{cache:"no-store"}).then(async r=>{if(!r.ok)throw Error();const d=await r.json();if(live){setP({...defaults,...d});setLoaded(true)}}).catch(()=>{if(live)setMsg("讀取失敗，請重新整理")}).finally(()=>{if(live)setBusy(false)});return()=>{live=false}},[organizationId]);
async function upload(file:File){setBusy(true);setMsg("");try{if(file.size>3500000)throw Error("檔案超過 3.5 MB");const f=new FormData();f.append("organizationId",organizationId);f.append("image",file);const r=await fetch(api,{method:"POST",body:f});if(!r.ok)throw Error("上傳失敗");const d=await r.json();setP(v=>({...v,asset:d.url}));setMsg("上傳完成，請儲存設定")}catch(e){setMsg(e instanceof Error?e.message:"上傳失敗")}finally{setBusy(false)}}
async function save(){setBusy(true);setMsg("");try{const r=await fetch(api,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({organizationId,config:p})});if(!r.ok)throw Error("儲存失敗，請檢查日期及素材");setMsg("已儲存")}catch(e){setMsg(e instanceof Error?e.message:"儲存失敗")}finally{setBusy(false)}}
return <section style={{border:"1px solid #ddd",borderRadius:16,padding:20,marginBottom:16}}><h2>會員首頁主題管理</h2><p>僅影響會員首頁，時間以台灣時間為準。</p><fieldset disabled={busy||!loaded} style={{border:0,padding:0,display:"grid",gap:12}}>
<label><input type="checkbox" checked={p.enabled} onChange={e=>setP({...p,enabled:e.target.checked})}/> 啟用主題</label>
<label>主題名稱 <input maxLength={80} value={p.name} onChange={e=>setP({...p,name:e.target.value})}/></label>
<label>背景素材（JPG、PNG、WebP、GIF、MP4，3.5 MB）<input type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4" onChange={e=>{const f=e.target.files?.[0];if(f)void upload(f)}}/></label>
{p.asset&&<><div style={{height:180,overflow:"hidden",position:"relative",background:"#f5f1ed"}}>{p.asset.endsWith(".mp4")?<video src={p.asset} muted autoPlay loop playsInline style={{width:"100%",height:"100%",objectFit:"cover",opacity:p.opacity/100}}/>:<img src={p.asset} alt="背景預覽" style={{width:"100%",height:"100%",objectFit:"cover",opacity:p.opacity/100}}/>}</div><button type="button" onClick={()=>setP({...p,asset:""})}>移除背景</button></>}
<label>動態特效 <select value={p.effect} onChange={e=>setP({...p,effect:e.target.value})}>{effects.map(([v,n])=><option key={v} value={v}>{n}</option>)}</select></label>
<label>背景不透明度 {p.opacity}% <input type="range" min={10} max={100} step={5} value={p.opacity} onChange={e=>setP({...p,opacity:Number(e.target.value)})}/></label>
<label>特效速度 <select value={p.speed} onChange={e=>setP({...p,speed:Number(e.target.value)})}><option value={1}>慢速</option><option value={2}>適中</option><option value={3}>快速</option></select></label>
<label>開始時間（留空立即啟用） <input type="datetime-local" value={p.start} onChange={e=>setP({...p,start:e.target.value})}/></label>
<label>結束時間（留空不限） <input type="datetime-local" value={p.end} onChange={e=>setP({...p,end:e.target.value})}/></label>
<button type="button" onClick={save}>儲存首頁主題</button></fieldset><p role="status">{busy?"處理中…":msg}</p></section>
}
