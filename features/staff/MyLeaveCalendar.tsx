"use client";

import { useMemo, useState } from "react";

export function MyLeaveCalendar({ locationId }: { locationId: string }) {
  const today = new Date();
  const [month, setMonth] = useState(() => {
    const next = new Date(today.getFullYear(), today.getMonth() + 1, 1);
    return next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0");
  });
  const [selected, setSelected] = useState<string[]>([]);
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [year, m] = month.split("-").map(Number);
  const count = new Date(year, m, 0).getDate();
  const offset = new Date(year, m - 1, 1).getDay();
  const days = useMemo(() => Array.from({ length: count }, (_, i) => month + "-" + String(i + 1).padStart(2, "0")), [count, month]);
  const minMonth = new Date(today.getFullYear(), today.getMonth(), 1);
  const maxMonth = new Date(today.getFullYear(), today.getMonth() + 6, 1);
  const currentMonth = new Date(year, m - 1, 1);
  const shift = (direction: number) => {
    const d = new Date(year, m - 1 + direction, 1);
    setMonth(d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"));
    setSelected([]);
    setNotice("");
    setError("");
  };
  const submit = async () => {
    if (!selected.length || submitting) return;
    setSubmitting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/staff/leave-requests/batch", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, dates: selected, reason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error === "LEAVE_ALREADY_REQUESTED"
        ? "部分日期已申請過，請重新選擇。" : "送出失敗：" + (result.error ?? response.status));
      setSaved(old => [...new Set([...old, ...selected])]);
      setNotice("已送出 " + selected.length + " 天休假申請，等待店長統一確認。");
      setSelected([]); setReason("");
    } catch (e) { setError(e instanceof Error ? e.message : "送出失敗"); }
    finally { setSubmitting(false); }
  };
  return (
    <section style={{ maxWidth: 560, margin: "32px auto", padding: 24, border: "1px solid #e5e1e0", borderRadius: 18 }}>
      <h1 style={{ fontSize: 26, fontWeight: 650, marginBottom: 8 }}>我的休假</h1>
      <p style={{ color: "#756d70", marginBottom: 24 }}>一次勾選多天，送出後皆為待確認，截止後由店長統一審核。</p>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
        <button type="button" disabled={currentMonth <= minMonth} onClick={() => shift(-1)} aria-label="上個月">‹</button>
        <strong>{year} 年 {m} 月</strong>
        <button type="button" disabled={currentMonth >= maxMonth} onClick={() => shift(1)} aria-label="下個月">›</button>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 6 }}>
        {["日","一","二","三","四","五","六"].map(d => <span key={d} style={{ textAlign: "center", color: "#81767a" }}>{d}</span>)}
        {Array.from({ length: offset }, (_, i) => <span key={"empty-" + i} />)}
        {days.map(date => {
          const picked = selected.includes(date), already = saved.includes(date);
          const valid = Date.parse(date + "T00:00:00+08:00") >= Date.now() - 86400000;
          return <button key={date} type="button" disabled={!valid || already} aria-pressed={picked}
            onClick={() => setSelected(old => picked ? old.filter(d => d !== date) : [...old, date].sort())}
            style={{ minHeight: 42, borderRadius: 9, border: picked ? "2px solid #ad7382" : "1px solid #ddd",
              background: picked ? "#f5e5e9" : already ? "#e8f1e8" : "transparent",
              opacity: valid ? 1 : 0.4, fontWeight: picked ? 700 : 400 }}>
            {Number(date.slice(-2))}
          </button>;
        })}
      </div>
      <p style={{ marginTop: 20 }}>已選擇 {selected.length} 天：{selected.map(d => d.slice(5).replace("-", "/")).join("、") || "尚未選擇"}</p>
      <label htmlFor="leave-reason" style={{ display: "block", marginTop: 16 }}>備註（選填）</label>
      <textarea id="leave-reason" maxLength={1000} value={reason} onChange={e => setReason(e.target.value)}
        style={{ width: "100%", minHeight: 76, border: "1px solid #ddd", borderRadius: 8, padding: 10 }} />
      <button type="button" disabled={!selected.length || submitting} onClick={submit}
        style={{ width: "100%", padding: 14, marginTop: 16, borderRadius: 10, background: "#9b6575", color: "white", opacity: !selected.length || submitting ? .5 : 1 }}>
        {submitting ? "送出中…" : "送出休假申請（待店長確認）"}
      </button>
      {notice && <p role="status" style={{ color: "#28734d", marginTop: 12 }}>{notice}</p>}
      {error && <p role="alert" style={{ color: "#b22b3b", marginTop: 12 }}>{error}</p>}
      <p style={{ fontSize: 12, color: "#81767a", marginTop: 16 }}>此頁不會直接核准休假。正式生效需店長確認。</p>
    </section>
  );
}
