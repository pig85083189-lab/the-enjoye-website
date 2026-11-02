"use client";

import { useState } from "react";

type LeaveRow = {
  id: string;
  staff_membership_id: string;
  leave_type: string;
  starts_at: string;
  status: string;
  reason: string;
};
type ConflictResult = { status: string; blockingCount: number; approvalEnabled: boolean; message: string };

export function StaffLeaveLiveReview({ locationIds, manager }: { locationIds: string[]; manager: boolean }) {
  const [locationId, setLocationId] = useState(locationIds[0] ?? "");
  const [rows, setRows] = useState<LeaveRow[]>([]);
  const [notice, setNotice] = useState("按「讀取真實假單」查看 Supabase 資料。正式資料表尚未啟用時會明確顯示錯誤。");
  const [busy, setBusy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [leaveDate, setLeaveDate] = useState("");
  const [leaveType, setLeaveType] = useState("scheduled_off");
  const [leaveReason, setLeaveReason] = useState("");
  const [checks, setChecks] = useState<Record<string, ConflictResult>>({});
  const [reviewing, setReviewing] = useState<string | null>(null);

  async function load() {
    if (!locationId) return;
    setBusy(true);
    setChecks({});
    try {
      const today = new Date();
      const from = new Date(today.getFullYear(), today.getMonth(), 1).toLocaleDateString("en-CA");
      const to = new Date(today.getFullYear(), today.getMonth() + 3, 0).toLocaleDateString("en-CA");
      const params = new URLSearchParams({ locationId, from, to });
      const response = await fetch("/api/staff/leave-requests?" + params, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "READ_FAILED");
      setRows(result.requests ?? []);
      setNotice("已讀取真實資料，僅顯示接下來約三個月內的申請。");
    } catch (error) {
      setRows([]);
      setNotice("無法讀取真實假單：" + (error instanceof Error ? error.message : "UNKNOWN_ERROR"));
    } finally { setBusy(false); }
  }

  async function submitLeave(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!locationId || !leaveDate || submitting) return;
    setSubmitting(true);
    try {
      const response = await fetch("/api/staff/leave-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locationId, date: leaveDate, leaveType, reason: leaveReason }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "SUBMISSION_FAILED");
      setNotice("休假申請已寫入資料庫，狀態為待審核。尚未影響預約空檔。");
      setLeaveReason("");
      await load();
    } catch (error) {
      setNotice("申請未完成：" + (error instanceof Error ? error.message : "UNKNOWN_ERROR"));
    } finally { setSubmitting(false); }
  }

  async function check(id: string) {
    setReviewing(id);
    try {
      const response = await fetch("/api/staff/leave-requests/" + encodeURIComponent(id) + "/conflicts?locationId=" + encodeURIComponent(locationId), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "CHECK_FAILED");
      setChecks((prev) => ({ ...prev, [id]: result }));
    } catch (error) {
      setNotice("衝突檢查失敗，禁止核准：" + (error instanceof Error ? error.message : "UNKNOWN_ERROR"));
    } finally { setReviewing(null); }
  }

  return (
    <section className="space-y-3 rounded-2xl border border-border bg-surface p-4" aria-label="真實休假資料">
      <h2 className="font-semibold">真實休假申請資料（安全測試）</h2>
      <p className="text-sm text-secondary-text">與上方示範資料分開顯示。衝突檢查僅供檢視，不能在這裡核准休假。</p>
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-sm">門市
          <select value={locationId} onChange={(event) => { setLocationId(event.target.value); setRows([]); setChecks({}); }} className="mt-1 block rounded-lg border border-border bg-surface p-2">
            {locationIds.map((id) => <option key={id} value={id}>{id}</option>)}
          </select>
        </label>
        <button type="button" disabled={!locationId || busy} onClick={load} className="rounded-lg border border-border px-4 py-2 text-sm disabled:opacity-50">{busy ? "讀取中…" : "讀取真實假單"}</button>
      </div>
      <form onSubmit={submitLeave} className="space-y-3 rounded-xl border border-border p-3">
        <h3 className="text-sm font-semibold">送出真實休假申請</h3>
        <p className="text-xs text-secondary-text">只有資料庫已啟用時才能送出。申請不等於核准，也不會直接封鎖預約。</p>
        <label className="block text-sm">假別
          <select value={leaveType} onChange={(event) => setLeaveType(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2">
            <option value="scheduled_off">排休</option><option value="annual">特休</option><option value="personal">事假</option><option value="sick">病假</option>
          </select>
        </label>
        <label className="block text-sm">休假日期
          <input type="date" required value={leaveDate} onChange={(event) => setLeaveDate(event.target.value)} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2" />
        </label>
        <label className="block text-sm">備註
          <textarea value={leaveReason} maxLength={1000} onChange={(event) => setLeaveReason(event.target.value)} rows={2} className="mt-1 block w-full rounded-lg border border-border bg-surface p-2" />
        </label>
        <button type="submit" disabled={!locationId || !leaveDate || submitting} className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50">{submitting ? "送出中…" : "送出真實申請"}</button>
      </form>
      <p role="status" className="text-sm text-secondary-text">{notice}</p>
      {rows.length === 0 && <p className="text-sm text-secondary-text">目前沒有可顯示的真實假單。</p>}
      {rows.map((row) => (
        <article key={row.id} className="rounded-xl border border-border p-3">
          <p className="text-sm font-medium">{row.staff_membership_id} · {row.starts_at.slice(0, 10)} · {row.leave_type}</p>
          <p className="mt-1 text-sm">{row.status} · {row.reason || "無備註"}</p>
          {manager && row.status === "pending" && (
            <button type="button" disabled={reviewing === row.id} onClick={() => check(row.id)} className="mt-2 rounded-lg border border-border px-3 py-2 text-sm disabled:opacity-50">檢查既有預約衝突</button>
          )}
          {checks[row.id] && <p role="status" className="mt-2 text-sm">檢查結果：{checks[row.id].blockingCount} 筆衝突。{checks[row.id].message}</p>}
        </article>
      ))}
    </section>
  );
}
