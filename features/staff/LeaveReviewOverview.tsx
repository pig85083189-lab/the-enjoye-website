"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

type Leave = {
  id: string;
  staff_membership_id: string;
  staff_display_name: string;
  starts_at: string;
  ends_at: string;
  leave_type: string;
  status: string;
  reason: string;
};
const TAIPEI_DATE = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit",
});
function dayOf(value: string) {
  const parts = TAIPEI_DATE.formatToParts(new Date(value));
  const get = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  return [get("year"), get("month"), get("day")].join("-");
}
function statusText(status: string) {
  return ({ pending: "待確認", approved: "已核准", rejected: "已駁回", cancelled: "已取消" } as Record<string, string>)[status] ?? status;
}
export function LeaveReviewOverview() {
  const { membership, currentLocation } = useOrganization();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    return next.getFullYear() + "-" + String(next.getMonth() + 1).padStart(2, "0");
  });
  const [rows, setRows] = useState<Leave[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const locationId = currentLocation?.id;
  const [year, monthNumber] = month.split("-").map(Number);
  const dayCount = new Date(year, monthNumber, 0).getDate();
  const offset = new Date(year, monthNumber - 1, 1).getDay();

  useEffect(() => {
    if (!locationId) { setLoading(false); setError("請先選擇分店"); return; }
    const controller = new AbortController();
    const [y, m] = month.split("-").map(Number);
    const last = new Date(y, m, 0).getDate();
    setLoading(true); setError(""); setRows([]); setSelectedDate(null);
    const params = new URLSearchParams({
      locationId, from: month + "-01", to: month + "-" + String(last).padStart(2, "0"),
    });
    fetch("/api/staff/leave-requests?" + params, { signal: controller.signal, cache: "no-store" })
      .then(async response => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "無法讀取休假申請");
        setRows(result.requests ?? []);
      })
      .catch(e => { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "無法讀取資料"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [locationId, month]);

  const grouped = useMemo(() => {
    const map = new Map<string, Leave[]>();
    for (const row of rows) {
      const date = dayOf(row.starts_at);
      map.set(date, [...(map.get(date) ?? []), row]);
    }
    return map;
  }, [rows]);
  const days = Array.from({ length: dayCount }, (_, i) => month + "-" + String(i + 1).padStart(2, "0"));
  const visibleDates = selectedDate ? [selectedDate] : [...grouped.keys()].sort();
  const pendingCount = rows.filter(row => row.status === "pending").length;

  if (!membership || !["OWNER", "MANAGER"].includes(membership.role)) {
    return <p>只有店長或管理者可以查看全員休假。</p>;
  }
  return <section style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 56px" }}>
    <h1 style={{ fontSize: 26, fontWeight: 650 }}>休假審核總覽</h1>
    <p style={{ margin: "8px 0 24px", color: "#827578" }}>
      B 方案：員工先填寫，截止後由店長統一確認。目前僅供檢視，尚未開放核准。
    </p>
    <label style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 20 }}>
      查看月份
      <input type="month" aria-label="查看月份" value={month} onChange={e => setMonth(e.target.value)}
        style={{ padding: 10, border: "1px solid #ddd", borderRadius: 8 }} />
    </label>
    {loading ? <p role="status">正在讀取申請…</p> : error ? <p role="alert" style={{ color: "#b42338" }}>讀取失敗：{error}</p> :
      <>
        <div style={{ padding: 18, border: "1px solid #e9dedf", borderRadius: 14, marginBottom: 20 }}>
          <strong>本月 {rows.length} 筆申請，其中 {pendingCount} 筆待確認</strong>
          <p style={{ color: "#827578", fontSize: 13, marginTop: 6 }}>
            月曆顯示申請數，不代表已符合最低人力。核准前仍須檢查班表、休假與預約衝突。
          </p>
        </div>
        <div style={{ border: "1px solid #e9dedf", borderRadius: 14, padding: 16, marginBottom: 20 }}>
          <h2 style={{ fontWeight: 650, marginBottom: 14 }}>{year} 年 {monthNumber} 月排休申請</h2>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0,1fr))", gap: 5 }}>
            {["日", "一", "二", "三", "四", "五", "六"].map(label =>
              <div key={label} style={{ textAlign: "center", color: "#827578", padding: 6 }}>{label}</div>)}
            {Array.from({ length: offset }, (_, i) => <div key={"empty-" + i} />)}
            {days.map(date => {
              const requests = grouped.get(date) ?? [];
              const pending = requests.filter(row => row.status === "pending").length;
              const active = selectedDate === date;
              return <button key={date} type="button" onClick={() => setSelectedDate(active ? null : date)}
                aria-pressed={active} aria-label={date + "，" + requests.length + " 筆申請"}
                style={{ minHeight: 68, padding: 5, borderRadius: 9, textAlign: "center",
                  border: active ? "2px solid #a56c7e" : "1px solid #e7dfe0",
                  background: active ? "#f3e0e5" : requests.length ? "#f9eef1" : "#fff" }}>
                <span style={{ display: "block", fontWeight: active ? 700 : 500 }}>{Number(date.slice(-2))}</span>
                {requests.length > 0 && <span style={{ fontSize: 11, color: "#895367" }}>
                  {pending ? pending + " 待審" : requests.length + " 筆"}
                </span>}
              </button>;
            })}
          </div>
          {selectedDate && <button type="button" onClick={() => setSelectedDate(null)}
            style={{ marginTop: 14, textDecoration: "underline", color: "#895367" }}>顯示整月申請</button>}
        </div>
        <h2 style={{ fontWeight: 650, fontSize: 18, marginBottom: 12 }}>
          {selectedDate ? selectedDate + " 申請明細" : "整月申請明細"}
        </h2>
        {visibleDates.filter(date => (grouped.get(date)?.length ?? 0) > 0).length === 0
          ? <p style={{ color: "#827578" }}>目前沒有符合條件的休假申請。</p>
          : visibleDates.filter(date => (grouped.get(date)?.length ?? 0) > 0).map(date =>
            <div key={date} style={{ border: "1px solid #e9dedf", borderRadius: 12, padding: 16, marginBottom: 12 }}>
              <h3 style={{ fontWeight: 650, marginBottom: 10 }}>{date} · {grouped.get(date)?.length} 筆</h3>
              {(grouped.get(date) ?? []).map(row =>
                <div key={row.id} style={{ padding: "12px 0", borderTop: "1px solid #eee" }}>
                  <strong>{row.staff_display_name || "未設定姓名"}</strong>
                  <span style={{ marginLeft: 12, fontSize: 13, color: "#895367" }}>{statusText(row.status)}</span>
                  {row.reason && <p style={{ marginTop: 6, fontSize: 13 }}>備註：{row.reason}</p>}
                </div>)}
            </div>)}
        <p style={{ marginTop: 24, fontSize: 12, color: "#827578" }}>
          尚未提供核准操作。待排休截止規則與安全核准交易完成後，才會開放店長統一確認。
        </p>
      </>}
  </section>;
}
