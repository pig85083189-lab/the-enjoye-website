"use client";

import { useEffect, useMemo, useState } from "react";

export function MyLeaveCalendar({ locationId }: { locationId: string }) {
  const today = new Date();
  const [month, setMonth] = useState(() => {
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0");
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [activeDate,setActiveDate]=useState("");
  const [reason, setReason] = useState("");

  const [dailyStart,setDailyStart]=useState("12:00");
  const [dailyEnd,setDailyEnd]=useState("13:00");
  const [dailyEnabled,setDailyEnabled]=useState(false);
  const [dailyLoaded,setDailyLoaded]=useState(false);
  const [dailySaving,setDailySaving]=useState(false);
  const [dailyEffective,setDailyEffective]=useState("");
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
  const [showLeaveList,setShowLeaveList]=useState(false);
  const [phase,setPhase]=useState<"leave"|"special"|"daily">("leave");
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
    setSelected([]);setActiveDate("");setPhase("leave");
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
  useEffect(() => {
    let active=true;
    fetch("/api/staff/recurring-break?"+new URLSearchParams({locationId}),{cache:"no-store"})
      .then(async response=>{const data=await response.json();if(!response.ok)throw new Error(data.error??"讀取固定休息時間失敗");return data;})
      .then(data=>{if(!active)return;setDailyEnabled(Boolean(data.break));if(data.break){setDailyStart(data.break.start);setDailyEnd(data.break.end);setDailyEffective(data.break.effectiveFrom);}setDailyLoaded(true);})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:"讀取固定休息時間失敗");});
    return()=>{active=false;};
  },[locationId]);
  const saveDaily = async () => {
    if(!dailyLoaded||dailySaving||submitting)return;
    if(dailyEnabled&&(!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyStart)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(dailyEnd)||dailyStart>=dailyEnd)){setError("固定休息時間格式不正確");return;}
    setDailySaving(true);setError("");setNotice("");
    try {
      const response=await fetch("/api/staff/recurring-break",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({locationId,start:dailyEnabled?dailyStart:null,end:dailyEnabled?dailyEnd:null})});
      const data=await response.json();
      if(!response.ok)throw new Error(data.error==="APPOINTMENT_CONFLICT"?"未來已有顧客預約與固定休息時間衝突，請先處理預約。":data.error??"儲存失敗");
      setDailyEffective(data.result?.effective_from??"");setNotice("統一休息時間已更新，從明日起生效。");
    }catch(e){setError(e instanceof Error?e.message:"儲存失敗");}
    finally{setDailySaving(false);}
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
      setSelected([]); setReason("");setPhase("special");setActiveDate("");setBreakDate("");setBreakLoaded(false);
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
    <section className="leave-page">
      <div className="leave-heading"><span className="leave-heading-icon">▦</span><div><h1>我的休假</h1>
      <p>管理整天排休、特殊休息時間與每日固定休息時間。</p></div></div><div className="leave-intro"><strong>休假與休息設定</strong><span>選擇日期後，在下方設定休假或休息時段</span></div>
      <div className="leave-steps">
        <button type="button" className={phase==="leave"?"current":""} onClick={()=>setPhase("leave")}>① 整月複選排休</button>
        <button type="button" className={phase==="special"?"current":""} disabled={selected.length>0} onClick={()=>setPhase("special")}>② 特殊休息時段</button>
        <button type="button" className={phase==="daily"?"current":""} disabled={selected.length>0} onClick={()=>setPhase("daily")}>③ 統一休息時間</button>
      </div>
      <div className="leave-calendar-wrap"><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
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
          return <button key={date} type="button" disabled={!valid || loading || submitting || readFailed} aria-pressed={phase==="leave"?picked:activeDate===date}
            onClick={() => {
              setActiveDate(date);
              if(phase==="leave"){
                if(!already)setSelected(old=>old.includes(date)?old.filter(d=>d!==date):[...old,date].sort());
              }else if(phase==="special"){
                if(!already)void loadBreaks(date);
                else {setBreakDate("");setBreakLoaded(false);setError("已排休的日期不能設定特殊休息時段。");}
              }
            }}
            style={{ minHeight: 42, borderRadius: 9, border: (picked||activeDate===date) ? "2px solid #ad7382" : "1px solid #ddd",
              background: (picked||activeDate===date) ? "#f5e5e9" : request?.status === "rejected" ? "#fff0e8" : already ? "#e8f1e8" : "transparent",
              opacity: valid ? 1 : 0.4, fontWeight: (picked||activeDate===date) ? 700 : 400 }}>
            {Number(date.slice(-2))}{request && <span style={{display:"block",fontSize:10}}>{request.status==="rejected"?"退回":request.status==="approved"?"已排休":request.status==="pending"?"舊制待審":"取消"}</span>}
          </button>;
        })}
      </div>
      <div className="leave-legend"><span>● 已排休</span><span>▢ {phase==="leave"?"點日期複選／取消":"點日期設定特殊時段"}</span></div></div><div className="leave-cards"><div className="leave-card" hidden={phase!=="leave"}>
      {loading && <p role="status">正在載入已申請的休假…</p>}
      {readFailed && <button type="button" onClick={()=>setRefresh(n=>n+1)} style={{marginTop:12,padding:10,border:"1px solid #ddd",borderRadius:8}}>重新讀取月曆</button>}
      <h2 style={{fontSize:19,marginTop:4}}>▦　排休日期</h2>
      <p style={{fontSize:13,color:"#756d70"}}>直接點選月曆上的多個日期，再按「確認本月排休」。再次點選可取消選取。</p>
      <div className="leave-selection-summary"><strong>本月已選取 {selected.length} 天</strong><button type="button" disabled={!selected.length} onClick={()=>setSelected([])}>清除選取</button></div>
      {requests.some(r=>r.status==="rejected") && <div style={{marginTop:16,padding:12,border:"1px solid #e8c9ba",borderRadius:10}}>
        <strong>店長退回的日期，請重新安排</strong>
        {requests.filter(r=>r.status==="rejected").map(r=><p key={r.id} style={{marginTop:8,fontSize:13}}>
          {new Date(new Date(r.starts_at).getTime()+8*3600000).toISOString().slice(0,10)}：
          {r.review_note || "請改選其他日期"}（原日期已解除占用）
        </p>)}
      </div>}
      <button type="button" className="leave-list-toggle" onClick={()=>setShowLeaveList(v=>!v)}>{showLeaveList?"收合已排休日期":"查看已排休日期（"+requests.filter(r=>r.status==="approved").length+" 天）"}</button>
      {showLeaveList && requests.filter(r=>r.status==="approved").map(r => {
        const date = new Date(new Date(r.starts_at).getTime()+8*3600000).toISOString().slice(0,10);
        return <div key={r.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:12}}>
          <span>{date} 已排休</span>
          <button type="button" disabled={submitting||loading||readFailed} onClick={()=>cancelLeave(date)}>取消休假</button>
        </div>;
      })}
      <><p style={{ marginTop: 20 }}>已選擇 {selected.length} 天：{selected.map(d => d.slice(5).replace("-", "/")).join("、") || "尚未選擇"}</p>
      <label htmlFor="leave-reason" style={{ display: "block", marginTop: 16 }}>備註（選填）</label>
      <textarea id="leave-reason" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}
        style={{ width: "100%", minHeight: 76, border: "1px solid #ddd", borderRadius: 8, padding: 10 }} />
      <button type="button" disabled={selected.length < 1 || submitting || loading || readFailed} onClick={submit}
        style={{ width: "100%", padding: 14, marginTop: 16, borderRadius: 10, background: "#9b6575", color: "white", opacity: !selected.length || submitting ? .5 : 1 }}>
        {submitting ? "儲存中…" : "確認本月排休"}
      </button>
      </>
      </div><div className="leave-card" hidden={phase!=="special"}>
        <p style={{fontSize:13,color:"#756d70",marginBottom:10}}>排休送出後再選擇仍上班的特殊日期。未設定特殊時段的日期，使用統一休息時間。</p>
        <h2 style={{fontSize:18,marginBottom:10}}>特殊未排休的休息時間</h2>
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
      </div><div className="leave-card" hidden={phase!=="daily"}>
        <h2 style={{fontSize:18,marginBottom:8}}>統一休息時間</h2>
        <p style={{fontSize:13,color:"#756d70"}}>適用每個上班日，不必逐日設定；整天排休日期自動略過。修改從明日起生效，已有預約衝突時會拒絕儲存。</p>
        <label style={{display:"flex",gap:8,alignItems:"center",marginBottom:12}}>
          <input type="checkbox" checked={dailyEnabled} disabled={!dailyLoaded||dailySaving} onChange={e=>setDailyEnabled(e.target.checked)}/> 啟用統一休息時間
        </label>
        {dailyEnabled && <div style={{display:"flex",gap:8}}>
          <label style={{flex:1}}>開始時間<input type="time" value={dailyStart} onChange={e=>setDailyStart(e.target.value)} style={{display:"block",width:"100%",padding:8,border:"1px solid #ddd",borderRadius:8}} /></label>
          <label style={{flex:1}}>結束時間<input type="time" value={dailyEnd} onChange={e=>setDailyEnd(e.target.value)} style={{display:"block",width:"100%",padding:8,border:"1px solid #ddd",borderRadius:8}} /></label>
        </div>}
        {dailyEffective && <p style={{fontSize:12,marginTop:10}}>目前設定生效日：{dailyEffective}</p>}
        <button type="button" disabled={!dailyLoaded||dailySaving||submitting} onClick={saveDaily} style={{width:"100%",padding:12,marginTop:14,borderRadius:10,background:"#9b6575",color:"white"}}>{dailySaving?"儲存中…":"儲存統一休息時間"}</button>
      </div></div>
      {phase==="special" && <button className="leave-next" type="button" onClick={()=>setPhase("daily")}>查看統一休息時間 →</button>}
      {notice && <p role="status" style={{ color: "#28734d", marginTop: 12 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b22b3b", marginTop: 12 }}>{error.includes("signal is aborted")?"資料讀取暫時中斷，請按「重新讀取月曆」。":error}</p>}
      <p style={{ fontSize: 12, color: "#81767a", marginTop: 16 }}>若該日已有顧客預約，系統會拒絕排休。舊制待審資料仍保留。</p>
      <style>{`.leave-page{width:100%;max-width:1320px;margin:12px auto 32px;padding:clamp(12px,2.2vw,28px);background:#fffaf8;border:1px solid #f0e4e3;border-radius:22px;color:#43383a;box-sizing:border-box}
.leave-page *{box-sizing:border-box}.leave-heading{display:flex;gap:14px;align-items:center;padding:10px 6px 18px}.leave-heading-icon{display:grid;place-items:center;width:48px;height:48px;background:#f6e8eb;color:#975c72;border-radius:14px;font-size:27px}.leave-heading h1{font-size:27px;font-weight:700;margin:0 0 6px}.leave-heading p{font-size:14px;color:#827276;margin:0}
.leave-intro{display:flex;align-items:center;gap:16px;flex-wrap:wrap;border-bottom:1px solid #eadcde;padding:10px 6px 18px;margin-bottom:18px}.leave-intro strong{color:#9b6575;border-bottom:3px solid #a56f80;padding:8px 4px}.leave-intro span{font-size:13px;color:#8a7b7e}
.leave-calendar-wrap{width:100%;padding:22px;background:#fff;border:1px solid #e9dddc;border-radius:19px;box-shadow:0 5px 22px #65425109;margin-bottom:18px}
.leave-calendar-wrap>div:first-child button{border:1px solid #eadcde;border-radius:10px;background:#fff7f8;color:#985d73;padding:5px 15px;font-size:20px}
.leave-calendar-wrap>div:nth-child(2){gap:8px!important}.leave-calendar-wrap>div:nth-child(2)>button{min-height:52px!important;border-radius:11px!important;transition:background .15s ease}
.leave-calendar-wrap>div:nth-child(2)>button[aria-pressed=true]{outline:2px solid #9b6575;outline-offset:1px}
.leave-legend{display:flex;justify-content:flex-end;gap:18px;font-size:12px;color:#817478;margin-top:16px}
.leave-cards{display:grid;grid-template-columns:minmax(0,1fr);align-items:start;gap:16px}
.leave-card[hidden]{display:none!important}.leave-steps{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:16px}.leave-steps button{border:1px solid #e3d0d7;border-radius:12px;padding:12px 16px;background:white;color:#86576a;cursor:pointer;font-weight:600}.leave-steps button.current{background:#9b6575;color:white}.leave-steps button:disabled{opacity:.4}.leave-selection-summary{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px;background:#fcf3f5;border-radius:12px}.leave-next{display:block;margin:18px 0 0 auto;padding:13px 20px;background:#9b6575;color:white;border:0;border-radius:12px}.leave-card{min-width:0;background:white;border:1px solid #e9dddc;border-radius:18px;padding:20px;box-shadow:0 5px 22px #65425109}
.leave-card h2{font-size:19px!important;line-height:1.5;color:#6d4554;margin:0 0 12px!important}
.leave-card button{cursor:pointer;border:1px solid #dfc8d0;background:#fff7f9;color:#855569;border-radius:10px;padding:9px 12px}
.leave-card button:disabled{cursor:not-allowed;opacity:.48}
.leave-card input[type=time]{max-width:100%;min-width:0;border:1px solid #e1d3d6;border-radius:9px}
.leave-card input[type=checkbox]{accent-color:#9b6575}.leave-card label{min-width:0}
.leave-card textarea{background:#fff}.leave-list-toggle{width:100%;margin-top:12px;text-align:left}
@media(max-width:1000px){.leave-cards{grid-template-columns:repeat(2,minmax(0,1fr))}.leave-card:last-child{grid-column:1/-1}}
@media(max-width:700px){.leave-page{padding:12px;margin:0 auto;border:0;border-radius:0}.leave-heading h1{font-size:23px}.leave-heading-icon{width:40px;height:40px}.leave-intro{gap:8px}.leave-calendar-wrap{padding:14px}.leave-calendar-wrap>div:nth-child(2){gap:4px!important}.leave-calendar-wrap>div:nth-child(2)>button{min-height:44px!important;font-size:13px}.leave-cards{grid-template-columns:1fr}.leave-card:last-child{grid-column:auto}.leave-card{padding:16px}.leave-legend{justify-content:flex-start}}`}</style>
    </section>
  );
}
