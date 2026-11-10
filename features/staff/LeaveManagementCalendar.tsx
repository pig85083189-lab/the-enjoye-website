"use client";

import { useEffect, useMemo, useState } from "react";

type LeaveRow = {
  id: string; staff_membership_id: string; staff_display_name: string;
  starts_at: string; status: string; leave_type: string;
};
const dateInTaipei = (value: string) => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date(value));

export function LeaveManagementCalendar({ locationId }: { locationId: string }) {
  const [month, setMonth] = useState(() => new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Taipei", year: "numeric", month: "2-digit",
  }).format(new Date()));
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [showLegacy, setShowLegacy] = useState(false);
  const [year, m] = month.split("-").map(Number);
  const dayCount = new Date(year, m, 0).getDate();
  const offset = new Date(year, m - 1, 1).getDay();
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError(""); setRows([]);
    const params = new URLSearchParams({
      locationId, from: month + "-01", to: month + "-" + String(dayCount).padStart(2,"0"),
    });
    fetch("/api/staff/leave-requests?" + params, {cache:"no-store",signal:controller.signal})
      .then(async response => {
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "讀取休假失敗");
        setRows(body.requests || []);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "讀取失敗"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [locationId, month, dayCount, refresh]);
  const approved = useMemo(() => rows.filter(r => r.status === "approved"),[rows]);
  const legacy = useMemo(() => rows.filter(r => r.status === "pending"),[rows]);
  const byDay = useMemo(() => {
    const map = new Map<string,LeaveRow[]>();
    for (const r of approved) {
      const date = dateInTaipei(r.starts_at);
      map.set(date,[...(map.get(date) || []),r]);
    }
    return map;
  },[approved]);
  const changeMonth = (delta:number) => {
    const d = new Date(year,m-1+delta,1);
    setMonth(d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"));
  };
  return <main style={{maxWidth:1000,margin:"0 auto",padding:"28px 20px",color:"#463c40"}}>
    <h1 style={{fontSize:28,fontWeight:650}}>休假管理</h1>
    <p style={{color:"#796d71",marginTop:8}}>美容師自行排休，儲存後立即生效，不需要店長審核。這裡僅查看已生效的休假。</p>
    <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",margin:"24px 0 16px"}}>
      <button type="button" onClick={()=>changeMonth(-1)} aria-label="上個月">‹ 上個月</button>
      <strong>{year} 年 {m} 月</strong>
      <button type="button" onClick={()=>changeMonth(1)} aria-label="下個月">下個月 ›</button>
    </div>
    {error && <p role="alert" style={{color:"#a32836"}}>休假資料讀取失敗：{error}。請重新整理，不會將舊申請視為已生效休假。</p>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(7,minmax(0,1fr))",gap:6}}>
      {["日","一","二","三","四","五","六"].map(d=><div key={d} style={{textAlign:"center",padding:8}}>{d}</div>)}
      {Array.from({length:offset},(_,i)=><div key={"empty-"+i}/>)}
      {Array.from({length:dayCount},(_,i)=>{
        const day=month+"-"+String(i+1).padStart(2,"0");
        const off=byDay.get(day)||[];
        return <div key={day} style={{minHeight:86,padding:9,border:"1px solid #e4dadd",borderRadius:9,background:off.length?"#f6ecee":"#fff"}}>
          <strong>{i+1}</strong>
          {off.length>0&&<div style={{fontSize:12,marginTop:5,color:"#965f6e"}}>{off.length} 位休假</div>}
          {off.map(r=><div key={r.id} style={{fontSize:12,overflowWrap:"anywhere",marginTop:4}}>{r.staff_display_name}</div>)}
        </div>;
      })}
    </div>
    {loading&&<p role="status">正在載入休假資料…</p>}
    <section style={{marginTop:26,padding:18,border:"1px solid #e4dadd",borderRadius:12}}>
      <h2 style={{fontSize:19,fontWeight:600}}>本月已生效休假：{approved.length} 筆</h2>
      {!loading&&!error&&approved.length===0&&<p style={{marginTop:10}}>目前沒有已生效的休假。</p>}
      {approved.map(r=><p key={r.id} style={{marginTop:9}}>{dateInTaipei(r.starts_at)}　{r.staff_display_name}　已排休</p>)}
    </section>
    <section style={{marginTop:18,padding:18,border:"1px solid #e4dadd",borderRadius:12}}>
      <h2 style={{fontSize:17,fontWeight:600}}>舊制歷史申請（{legacy.length} 筆）</h2>
      <p style={{fontSize:13,color:"#796d71",marginTop:6}}>舊版待確認申請不會自動生效，也不會在這裡審核或退回。</p>
      <button type="button" onClick={()=>setShowLegacy(v=>!v)} style={{marginTop:10}}>{showLegacy?"收合歷史紀錄":"查看歷史紀錄"}</button>
      {showLegacy&&legacy.map(r=><p key={r.id} style={{marginTop:8}}>{dateInTaipei(r.starts_at)}　{r.staff_display_name}　舊制待確認</p>)}
    </section>
    <button type="button" onClick={()=>setRefresh(v=>v+1)} style={{marginTop:20}}>重新整理</button>
  </main>;
}
