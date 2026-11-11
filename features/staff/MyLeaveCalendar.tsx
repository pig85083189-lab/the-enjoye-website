"use client";

import { useEffect, useMemo, useState } from "react";

export function MyLeaveCalendar({ locationId }: { locationId: string }) {
  const today = new Date();
  const [month, setMonth] = useState(() => {
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0");
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [mode, setMode] = useState<"leave"|"break">("leave");
  const [breakDate, setBreakDate] = useState("");
  const [breaks, setBreaks] = useState<Array<{start:string;end:string}>>([]);
  const [breakLoaded, setBreakLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [requests, setRequests] = useState<Array<{id:string;starts_at:string;status:string;review_note:string|null}>>([]);
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [error, setError] = useState("");
  const [year, m] = month.split("-").map(Number);
  const count = new Date(year, m, 0).getDate();
  const offset = new Date(year, m - 1, 1).getDay();
  const days = useMemo(() => Array.from({ length: count }, (_, i) => month + "-" + String(i + 1).padStart(2, "0")), [count, month]);
  useEffect(() => {
    const controller = new AbortController();
    const [y, mo] = month.split("-").map(Number);
    const last = String(new Date(y, mo, 0).getDate()).padStart(2, "0");
    const params = new URLSearchParams({locationId,from:month+"-01",to:month+"-"+last});
    setLoading(true); setReadFailed(false); setError(""); setRequests([]);
    fetch("/api/staff/leave-requests?"+params,{signal:controller.signal,cache:"no-store"})
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "讀取申請失敗");
        const own = (result.requests ?? []).filter((item:{staff_membership_id:string}) =>
          item.staff_membership_id === result.viewer?.staffMembershipId);
        setRequests(own);
      }).catch(e => {if (!controller.signal.aborted && !(e instanceof Error && e.name === "AbortError")) { setReadFailed(true); setError(e instanceof Error ? e.message : "讀取申請失敗"); }})
      .finally(() => {if (!controller.signal.aborted) setLoading(false);});
    return () => controller.abort();
  },[locationId,month,refresh]);
  const requestByDate = useMemo(() => new Map(requests.map(r => [
    new Date(new Date(r.starts_at).getTime()+8*3600000).toISOString().slice(0,10),r
  ])),[requests]);
  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const maxMonth = new Date(today.getFullYear(), today.getMonth() + 6, 1);
  const currentMonth = new Date(year, m - 1, 1);
  const shift = (direction: number) => {
    const d = new Date(year, m - 1 + direction, 1);
    setMonth(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    setSelected([]);
    setBreakDate("");setBreakLoaded(false);
    setNotice("");
    setError("");
  };
  const loadBreaks = async (date: string) => {
    if (["approved","pending"].includes(requestByDate.get(date)?.status ?? "")) { setBreakDate(""); setBreakLoaded(false); setError("這一天已整天排休，請先取消整天排休，才能設定休息時段。"); return; }
    setBreakDate(date); setBreakLoaded(false); setError(""); setNotice("");
    setSubmitting(true);
    try {
      const params = new URLSearchParams({locationId,date});
      const response = await fetch("/api/staff/my-breaks?"+params,{cache:"no-store"});
      const result = await response.json();
      if (!response.ok || !Array.isArray(result.breaks)) throw new Error(result.error ?? "讀取休息時間失敗");
      setBreaks(result.breaks); setBreakLoaded(true);
    } catch(e) { setError(e instanceof Error ? e.message : "讀取失敗"); }
    finally { setSubmitting(false); }
  };
  const saveBreaks = async () => {
    if (!breakLoaded || !breakDate || submitting) return;
    if (["approved","pending"].includes(requestByDate.get(breakDate)?.status ?? "")) { setError("已整天排休的日期不能設定休息時段。"); return; }
    const sorted=[...breaks].sort((a,b)=>a.start.localeCompare(b.start));
    const clock=/^([01]\d|2[0-3]):[0-5]\d$/;
    if(sorted.some((b,i)=>!clock.test(b.start)||!clock.test(b.end)||b.start>=b.end||(i>0&&sorted[i-1].end>b.start))){setError("休息時段不可重疊，且結束時間必須晚於開始時間。");return;}
    if(!sorted.length&&!window.confirm("確定要清除當天全部休息時段嗎？"))return;
    setSubmitting(true);setError("");setNotice("");
    try {
      const response=await fetch("/api/staff/my-breaks",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId,date:breakDate,breaks:sorted})});
      const result=await response.json();
      if(!response.ok)throw new Error(result.error==="APPOINTMENT_CONFLICT"?"已有顧客預約與休息時間衝突，請先處理預約。":result.error??"儲存失敗");
      setBreakLoaded(false);setNotice("休息時間已儲存，請重新讀取確認。");
    } catch(e){setError(e instanceof Error?e.message:"儲存失敗");}
    finally{setSubmitting(false);}
  };
  const submit = async () => {
    if (selected.length < 1 || submitting || loading || readFailed) return;
    setSubmitting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/leave-requests/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, dates: selected, reason }),
      });
      const result = await response.json();
      if (!response.ok) {
        const messages: Record<string, string> = {
          LEAVE_ALREADY_REQUESTED: "這一天已經排休，請重新整理月曆。",
          LEAVE_ALREADY_EXISTS: "這一天已經排休，請重新整理月曆。",
          APPOINTMENT_CONFLICT: "這一天已有顧客預約，無法排休。請先處理預約。",
          LEAVE_CONFLICT: "休假與現有班表或預約衝突，請先確認。",
          LEAVE_RPC_UNAVAILABLE: "排休服務暫時無法使用，請聯絡管理員。",
          LEAVE_RPC_PERMISSION_DENIED: "目前沒有儲存休假的權限，請聯絡管理員。",
        };
        throw new Error(messages[result.error] ?? "送出失敗：" + (result.error ?? response.status));
      }
      setRefresh(n => n+1);
      setNotice("休假已儲存，預約時段同步封鎖。");
      setSelected([]); setReason("");
    } catch (e) { setError(e instanceof Error ? e.message : "送出失敗"); }
    finally { setSubmitting(false); }
  };
  const cancelLeave = async (date: string) => {
    if (submitting || loading || readFailed || !window.confirm("確定取消 " + date + " 的休假嗎？")) return;
    setSubmitting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/leave-requests/cancel", {
        method: "POST", headers: {"Content-Type":"application/json"},
        body: JSON.stringify({locationId,date}),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "取消失敗");
      setNotice("已取消休假。"); setRefresh(n => n+1);
    } catch (e) { setError(e instanceof Error ? e.message : "取消失敗"); }
    finally { setSubmitting(false); }
  };
  return (
    <section style={{ maxWidth: 560, margin: "32px auto", padding: 24, border: "1px solid #e5e1e0", borderRadius: 18 }}>
      <h1 style={{ fontSize: 26, fontWeight: 650, marginBottom: 8 }}>我的休假</h1>
      <p style={{ color: "#756d70", marginBottom: 24 }}>自行選擇休假日期，儲存後立即生效，不需店長審核。可一次選擇多天，點選日期即可加入或取消選取。</p>
      <div style={{display:"flex",gap:8,marginBottom:18}}>
        <button type="button" onClick={()=>{setMode("leave");setError("");}} aria-pressed={mode==="leave"} style={{flex:1,padding:10,borderRadius:10,background:mode==="leave"?"#f5e5e9":"#f6f4f3",border:"1px solid #d8c8c4"}}>整天排休</button>
        <button type="button" onClick={()=>{setMode("break");setSelected([]);setError("");}} aria-pressed={mode==="break"} style={{flex:1,padding:10,borderRadius:10,background:mode==="break"?"#f5e5e9":"#f6f4f3",border:"1px solid #d8c8c4"}}>自訂休息時段</button>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button type="button" disabled={currentMonth <= minMonth} onClick={() => shift(-1)} aria-label="上個月">‹</button>
        <strong>{year} 年 {m} 月</strong>
        <button type="button" disabled={currentMonth >= maxMonth} onClick={() => shift(1)} aria-label="下個月">›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
        {["日","一","二","三","四","五","六"].map(d => <span key={d} style={{ textAlign: "center", color: "#81767a" }}>{d}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={"empty-" + i} />)}
        {days.map(date => {
          const picked = selected.includes(date), request = requestByDate.get(date), already = request?.status === "pending" || request?.status === "approved";
          const valid = date >= new Date(Date.now() + 8 * 3600000).toISOString().slice(0, 10);
          return <button key={date} type="button" disabled={!valid || already || loading || submitting || readFailed} aria-pressed={mode==="leave"?picked:breakDate===date}
            onClick={() => mode==="leave" ? setSelected(old => picked ? old.filter(item => item !== date) : [...old, date].sort()) : loadBreaks(date)}
            style={{ minHeight: 42, borderRadius: 9, border: (mode==="leave"?picked:breakDate===date) ? "2px solid #ad7382" : "1px solid #ddd",
              background: (mode==="leave"?picked:breakDate===date) ? "#f5e5e9" : request?.status === "rejected" ? "#fff0e8" : already ? "#e8f1e8" : "transparent",
              opacity: valid ? 1 : 0.4, fontWeight: (mode==="leave"?picked:breakDate===date) ? 700 : 400 }}>
            {Number(date.slice(-2))}{request && <span style={{display:"block",fontSize:10}}>{request.status==="rejected"?"退回":request.status==="approved"?"已排休":request.status==="pending"?"舊制待審":"取消"}</span>}
          </button>;
        })}
      </div>
      {loading && <p role="status">正在載入已申請的休假…</p>}
      {readFailed && <button type="button" onClick={()=>setRefresh(n=>n+1)} style={{marginTop:12,padding:10,border:"1px solid #ddd",borderRadius:8}}>重新讀取月曆</button>}
      {mode==="break" && <div style={{marginTop:18,padding:14,border:"1px solid #e5e1e0",borderRadius:12}}>
        <p style={{fontSize:13,color:"#756d70",marginBottom:10}}>已排休或舊制待審日期不可新增休息時段。請先取消整天排休。</p>
        <strong>{breakDate?breakDate+" 休息時段":"請先點選月曆日期"}</strong>
        {breakLoaded && <>
          {breaks.map((b,i)=><div key={i} style={{display:"flex",gap:8,alignItems:"end",marginTop:12}}>
            <label style={{flex:1}}>開始<input type="time" value={b.start} disabled={submitting} onChange={e=>setBreaks(old=>old.map((v,j)=>j===i?{...v,start:e.target.value}:v))} style={{display:"block",width:"100%",padding:8,border:"1px solid #ddd",borderRadius:8}} /></label>
            <label style={{flex:1}}>結束<input type="time" value={b.end} disabled={submitting} onChange={e=>setBreaks(old=>old.map((v,j)=>j===i?{...v,end:e.target.value}:v))} style={{display:"block",width:"100%",padding:8,border:"1px solid #ddd",borderRadius:8}} /></label>
            <button type="button" disabled={submitting} onClick={()=>setBreaks(old=>old.filter((_,j)=>i!==j))}>移除</button>
          </div>)}
          <button type="button" disabled={submitting||breaks.length>=12} onClick={()=>setBreaks(old=>[...old,{start:"12:00",end:"13:00"}])} style={{marginTop:14}}>＋ 新增時段</button>
          <button type="button" disabled={submitting} onClick={saveBreaks} style={{display:"block",width:"100%",marginTop:14,padding:12,background:"#9b6575",color:"white",borderRadius:10}}>儲存休息時段</button>
        </>}
        {breakDate && !breakLoaded && <button type="button" disabled={submitting} onClick={()=>loadBreaks(breakDate)} style={{marginTop:12}}>重新讀取休息時段</button>}
      </div>}
      {mode==="leave" && requests.some(r=>r.status==="rejected") && <div style={{marginTop:16,padding:12,border:"1px solid #e8c9ba",borderRadius:10}}>
        <strong>店長退回的日期，請重新安排</strong>
        {requests.filter(r=>r.status==="rejected").map(r=><p key={r.id} style={{marginTop:8,fontSize:13}}>
          {new Date(new Date(r.starts_at).getTime()+8*3600000).toISOString().slice(0,10)}：
          {r.review_note || "請改選其他日期"}（原日期已解除占用）
        </p>)}
      </div>}
      {mode==="leave" && requests.filter(r=>r.status==="approved").map(r => {
        const date = new Date(new Date(r.starts_at).getTime()+8*3600000).toISOString().slice(0,10);
        return <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
          <span>{date} 已排休</span>
          <button type="button" disabled={submitting||loading||readFailed} onClick={()=>cancelLeave(date)}>取消休假</button>
        </div>;
      })}
      {mode==="leave" && <><p style={{ marginTop: 20 }}>已選擇 {selected.length} 天：{selected.map(d => d.slice(5).replace("-", "/")).join("、") || "尚未選擇"}</p>
      <label htmlFor="leave-reason" style={{ display: "block", marginTop: 16 }}>備註（選填）</label>
      <textarea id="leave-reason" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}
        style={{ width: "100%", minHeight: 76, border: "1px solid #ddd", borderRadius: 8, padding: 10 }} />
      <button type="button" disabled={selected.length < 1 || submitting || loading || readFailed} onClick={submit}
        style={{ width: "100%", padding: 14, marginTop: 16, borderRadius: 10, background: "#9b6575", color: "white", opacity: !selected.length || submitting ? .5 : 1 }}>
        {submitting ? "儲存中…" : "儲存休假（立即生效）"}
      </button>
      </>}
      {notice && <p role="status" style={{ color: "#28734d", marginTop: 12 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b22b3b", marginTop: 12 }}>{error.includes("signal is aborted")?"資料讀取暫時中斷，請按「重新讀取月曆」。":error}</p>}
      <p style={{ fontSize: 12, color: "#81767a", marginTop: 16 }}>若該日已有顧客預約，系統會拒絕排休。舊制待審資料仍保留。</p>
    </section>
  );
}
