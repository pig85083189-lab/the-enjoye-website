"use client";

import { useState } from "react";

type BreakRow = { start: string; end: string };
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

export default function BookingBreaksPage() {
  const [locationId, setLocationId] = useState("");
  const [staffId, setStaffId] = useState("");
  const [date, setDate] = useState("");
  const [breaks, setBreaks] = useState<BreakRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const valid = Boolean(locationId.trim() && staffId.trim() && DATE.test(date));
  async function load() {
    if (!valid || busy) return;
    setBusy(true); setMessage(""); setLoaded(false);
    try {
      const query = new URLSearchParams({ locationId: locationId.trim(), staffId: staffId.trim(), date });
      const response = await fetch("/api/staff/booking-breaks?" + query, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok || !result.ok || !Array.isArray(result.breaks)) throw new Error(result.error || "讀取失敗");
      setBreaks(result.breaks); setLoaded(true); setMessage("已讀取休息時段。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "讀取失敗"); }
    finally { setBusy(false); }
  }
  async function save() {
    if (!valid || !loaded || busy) return;
    if (breaks.some(row => !CLOCK.test(row.start) || !CLOCK.test(row.end) || row.start >= row.end)) {
      setMessage("請確認所有休息時段的開始與結束時間。"); return;
    }
    const sorted = [...breaks].sort((a,b) => a.start.localeCompare(b.start));
    if (sorted.some((row,i) => i > 0 && sorted[i-1].end > row.start)) {
      setMessage("休息時段不可重疊。"); return;
    }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/staff/booking-breaks", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId: locationId.trim(), staffId: staffId.trim(), date, breaks: sorted }),
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.error || "儲存失敗");
      setMessage("已儲存。會員預約同步仍待驗證，尚未開放預約。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "儲存失敗"); }
    finally { setBusy(false); }
  }
  const inputStyle = { border: "1px solid #bbb", borderRadius: 8, padding: 10, width: "100%", background: "white", color: "#222" };
  return (
    <main style={{ maxWidth: 680, margin: "40px auto", padding: 20 }}>
      <h1 style={{ fontSize: 26, fontWeight: 700, marginBottom: 12 }}>美容師休息時間管理</h1>
      <p style={{ marginBottom: 20 }}>管理員測試功能。請先輸入所屬門市與美容師代碼並讀取，才能編輯。正式會員預約尚未開放。</p>
      <div style={{ display: "grid", gap: 12 }}>
        <label>門市代碼<input style={inputStyle} value={locationId} onChange={e => { setLocationId(e.target.value); setLoaded(false); }} placeholder="例如 loc-enjoye-main" /></label>
        <label>美容師代碼<input style={inputStyle} value={staffId} onChange={e => { setStaffId(e.target.value); setLoaded(false); }} placeholder="例如 staff-001" /></label>
        <label>日期<input style={inputStyle} type="date" value={date} onChange={e => { setDate(e.target.value); setLoaded(false); }} /></label>
        <button type="button" disabled={!valid || busy} onClick={load} style={{ padding: 12, borderRadius: 8, background: "#e6d7d3", color: "#222" }}>讀取休息時間</button>
        {loaded && <>
          {breaks.map((row, index) => (
            <div key={index} style={{ display: "flex", alignItems: "end", gap: 10 }}>
              <label style={{ flex: 1 }}>開始<input type="time" style={inputStyle} value={row.start} onChange={e => setBreaks(old => old.map((r,i) => i === index ? { ...r, start: e.target.value } : r))} /></label>
              <label style={{ flex: 1 }}>結束<input type="time" style={inputStyle} value={row.end} onChange={e => setBreaks(old => old.map((r,i) => i === index ? { ...r, end: e.target.value } : r))} /></label>
              <button type="button" onClick={() => setBreaks(old => old.filter((_,i) => i !== index))}>移除</button>
            </div>
          ))}
          <button type="button" disabled={busy || breaks.length >= 12} onClick={() => setBreaks(old => [...old, { start: "12:00", end: "13:00" }])}>新增休息時段</button>
          <button type="button" disabled={busy} onClick={save} style={{ padding: 12, borderRadius: 8, background: "#d8c8c4", color: "#222", fontWeight: 700 }}>儲存休息時間</button>
        </>}
        {message && <p role="status">{message}</p>}
      </div>
    </main>
  );
}
