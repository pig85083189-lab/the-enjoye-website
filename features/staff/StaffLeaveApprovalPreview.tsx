"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { StaffLeaveLiveReview } from "./StaffLeaveLiveReview";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, ShieldCheck } from "lucide-react";

type RequestStatus = "REQUESTED" | "APPROVED" | "REJECTED";
type LeaveRequest = {
  id: number;
  staff: string;
  date: string;
  kind: string;
  reason: string;
  status: RequestStatus;
};
const INITIAL: LeaveRequest[] = [
  { id: 1, staff: "宜欣", date: "2026-11-12", kind: "排休", reason: "個人行程", status: "REQUESTED" },
  { id: 2, staff: "測試帳號", date: "2026-11-18", kind: "事假", reason: "私人事務", status: "REQUESTED" },
  { id: 3, staff: "宜欣", date: "2026-11-23", kind: "排休", reason: "例行排休", status: "APPROVED" },
];
const STATUS: Record<RequestStatus, string> = { REQUESTED: "待審核", APPROVED: "已核准", REJECTED: "已駁回" };
const pad = (n: number) => String(n).padStart(2, "0");

export function StaffLeaveApprovalPreview({ role, locationIds }: { role: string; locationIds: string[] }) {
  const manager = role === "OWNER" || role === "MANAGER" || role === "ADMIN";
  const [tab, setTab] = useState<"calendar" | "review" | "request">("calendar");
  const [month, setMonth] = useState(10);
  const [requests, setRequests] = useState<LeaveRequest[]>(INITIAL);
  const [date, setDate] = useState("2026-11-16");
  const [kind, setKind] = useState("排休");
  const [reason, setReason] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedDay, setSelectedDay] = useState(12);
  const year = 2026;
  const days = new Date(year, month + 1, 0).getDate();
  const start = new Date(year, month, 1).getDay();
  const datePrefix = `${year}-${pad(month + 1)}-`;
  const pending = requests.filter((item) => item.status === "REQUESTED").length;
  const selected = useMemo(() => requests.filter((item) => item.date === datePrefix + pad(selectedDay)), [requests, datePrefix, selectedDay]);

  function review(id: number, status: RequestStatus) {
    if (!manager) return;
    setRequests((prev) => prev.map((item) => item.id === id ? { ...item, status } : item));
    setNotice("已更新示範審核狀態。尚未寫入資料庫，也不會影響會員預約空檔。");
  }
  function submit() {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00"))) {
      setNotice("請選擇有效日期。"); return;
    }
    setRequests((prev) => [{ id: Math.max(0, ...prev.map((item) => item.id)) + 1, staff: "目前登入員工（示範）", date, kind, reason: reason.trim(), status: "REQUESTED" }, ...prev]);
    setReason("");
    setTab("review");
    setNotice("已加入示範申請清單。尚未正式送出，重新整理後會恢復。");
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5 pb-12" data-staff-leave-preview>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs tracking-widest text-secondary-text">BEAUTY OS / STAFF</p>
          <h1 className="mt-1 text-2xl font-semibold text-text">人員排班與休假管理</h1>
          <p className="mt-1 text-sm text-secondary-text">固定班表、排休申請、店長審核與預約空檔同步規劃</p>
        </div>
        <Link href="/staff/staff" className="rounded-xl border border-border bg-surface px-4 py-2 text-sm text-text">返回員工管理</Link>
      </header>
      <div role="status" className="rounded-xl border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900">
        功能預覽版：目前所有排休與審核操作僅在此頁面暫存，不會寫入正式資料庫、通知員工或封鎖會員預約。現有固定班表不受影響。
      </div>
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {[
          { label: "示範員工", value: "2", icon: CalendarDays },
          { label: "待審核申請", value: String(pending), icon: Clock3 },
          { label: "已核准休假", value: String(requests.filter((r) => r.status === "APPROVED").length), icon: ShieldCheck },
        ].map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex items-center gap-2 text-sm text-secondary-text"><Icon size={16}/>{label}</div>
            <p className="mt-2 text-3xl font-semibold text-text">{value}</p>
          </div>
        ))}
      </section>
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="排班管理檢視">
        {([
          ["calendar", "月排班"],
          ["review", `休假審核 (${pending})`],
          ["request", "提出休假申請"],
        ] as const).map(([key, label]) => (
          <button type="button" key={key} role="tab" aria-selected={tab === key} onClick={() => { setTab(key); setNotice(""); }}
            className={`rounded-xl px-4 py-2 text-sm font-medium ${tab === key ? "bg-primary text-white" : "border border-border bg-surface text-text"}`}>{label}</button>
        ))}
      </div>
      {notice && <p role="status" className="rounded-xl bg-primary-light/30 p-3 text-sm text-text">{notice}</p>}
      {tab === "calendar" && (
        <section className="rounded-2xl border border-border bg-surface p-4">
          <div className="mb-4 flex items-center justify-between">
            <button type="button" aria-label="上個月" onClick={() => { setMonth((m) => Math.max(0, m - 1)); setSelectedDay(1); }} disabled={month === 0} className="rounded-lg border border-border p-2 disabled:opacity-30"><ChevronLeft size={18}/></button>
            <h2 className="font-semibold">{year} 年 {month + 1} 月</h2>
            <button type="button" aria-label="下個月" onClick={() => { setMonth((m) => Math.min(11, m + 1)); setSelectedDay(1); }} disabled={month === 11} className="rounded-lg border border-border p-2 disabled:opacity-30"><ChevronRight size={18}/></button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-secondary-text">{["日","一","二","三","四","五","六"].map((d) => <div key={d} className="py-2">{d}</div>)}</div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: start }, (_, i) => <div key={`blank-${i}`}/>)}
            {Array.from({ length: days }, (_, i) => {
              const day = i + 1;
              const entries = requests.filter((r) => r.date === datePrefix + pad(day));
              return <button type="button" key={day} onClick={() => setSelectedDay(day)} aria-pressed={selectedDay === day}
                className={`min-h-16 rounded-lg border p-1 text-left text-xs sm:min-h-20 sm:p-2 ${selectedDay === day ? "border-primary bg-primary-light/30" : "border-border"}`}>
                <span className="font-medium">{day}</span>
                {entries.slice(0, 2).map((r) => <span key={r.id} className="mt-1 block truncate rounded bg-primary-light/40 px-1 py-0.5 text-[10px]">{r.status === "APPROVED" ? "休假" : r.status === "REQUESTED" ? "待審" : "駁回"} · {r.staff}</span>)}
              </button>;
            })}
          </div>
          <div className="mt-4 rounded-xl bg-primary-light/20 p-3">
            <h3 className="text-sm font-semibold">{month + 1} 月 {selectedDay} 日 · 休假紀錄</h3>
            {selected.length ? selected.map((r) => <p key={r.id} className="mt-2 text-sm">{r.staff} · {r.kind} · {STATUS[r.status]}</p>) : <p className="mt-2 text-sm text-secondary-text">示範資料中無休假申請。正式班表尚未連接。</p>}
          </div>
        </section>
      )}
      {tab === "review" && (
        <section className="space-y-3">
          <StaffLeaveLiveReview locationIds={locationIds} manager={manager} />
          <p className="text-sm text-secondary-text">{manager ? "店長審核示意：核准前應先檢查既有預約衝突。" : "目前角色僅可查看示範申請，不可核准或駁回。"}</p>
          {requests.map((r) => <article key={r.id} className="rounded-2xl border border-border bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div><h3 className="font-semibold">{r.staff}</h3><p className="text-sm text-secondary-text">{r.date} · {r.kind}</p></div>
              <span className="rounded-full bg-primary-light/40 px-3 py-1 text-xs">{STATUS[r.status]}</span>
            </div>
            <p className="mt-3 text-sm">原因：{r.reason || "未填寫"}</p>
            {manager && r.status === "REQUESTED" && <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => review(r.id, "REJECTED")} className="rounded-lg border border-border px-4 py-2 text-sm">駁回（示範）</button>
              <button type="button" onClick={() => review(r.id, "APPROVED")} className="rounded-lg bg-primary px-4 py-2 text-sm text-white">核准（示範）</button>
            </div>}
          </article>)}
        </section>
      )}
      {tab === "request" && (
        <section className="max-w-xl space-y-4 rounded-2xl border border-border bg-surface p-5">
          <h2 className="text-lg font-semibold">提出休假申請</h2>
          <label className="block text-sm">假別<select value={kind} onChange={(e) => setKind(e.target.value)} className="mt-2 block w-full rounded-lg border border-border bg-surface p-3">{["排休","特休","事假","病假"].map((v) => <option key={v}>{v}</option>)}</select></label>
          <label className="block text-sm">休假日期<input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-2 block w-full rounded-lg border border-border bg-surface p-3"/></label>
          <label className="block text-sm">備註<textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="選填" className="mt-2 block w-full rounded-lg border border-border bg-surface p-3"/></label>
          <button type="button" onClick={submit} className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-white">加入示範申請清單</button>
        </section>
      )}
    </div>
  );
}
