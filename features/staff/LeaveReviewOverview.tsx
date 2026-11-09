"use client";

import { useEffect, useMemo, useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

type Leave = {
 id: string; staff_membership_id: string; starts_at: string; ends_at: string;
 leave_type: string; status: string; reason: string;
};
const LOCAL_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Taipei", year: "numeric", month: "2-digit", day: "2-digit" });
function dayOf(value: string) {
 const parts = LOCAL_DATE.formatToParts(new Date(value));
 const find = (key: string) => parts.find(p => p.type === key)?.value ?? "";
 return [find("year"),find("month"),find("day")].join("-");
}
export function LeaveReviewOverview() {
 const { membership, currentLocation } = useOrganization();
 const now = new Date();
 const [month, setMonth] = useState(() => {
  const d = new Date(now.getFullYear(),now.getMonth()+1,1);
  return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
 });
 const [rows,setRows] = useState<Leave[]>([]);
 const [loading,setLoading] = useState(true);
 const [error,setError] = useState("");
 const locationId = currentLocation?.id;
 useEffect(() => {
  if (!locationId) { setLoading(false);setError("請先選擇分店");return; }
  const controller = new AbortController();
  const [year,m] = month.split("-").map(Number);
  const last = new Date(year,m,0).getDate();
  setLoading(true);setError("");setRows([]);
  const params = new URLSearchParams({ locationId, from:month+"-01",to:month+"-"+String(last).padStart(2,"0") });
  fetch("/api/staff/leave-requests?"+params,{signal:controller.signal,cache:"no-store"})
   .then(async response => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "無法讀取休假申請");
    setRows(result.requests ?? []);
   })
   .catch(e => {if (!controller.signal.aborted) setError(e instanceof Error?e.message:"無法讀取資料");})
   .finally(() => {if (!controller.signal.aborted) setLoading(false);});
  return () => controller.abort();
 },[locationId,month]);
 const grouped = useMemo(() => {
  const map = new Map<string,Leave[]>();
  for (const row of rows) {
   const date = dayOf(row.starts_at);
   map.set(date,[...(map.get(date)??[]),row]);
  }
  return [...map].sort(([a],[b])=>a.localeCompare(b));
 },[rows]);
 if (!membership || !["OWNER","MANAGER"].includes(membership.role)) return <p>只有店長或管理者可以查看全員休假。</p>;
 return <section className="mx-auto max-w-4xl space-y-5 p-4 sm:p-8">
  <div><h1 className="text-2xl font-semibold">休假審核總覽</h1>
   <p className="mt-2 text-sm text-secondary-text">B 方案：員工先填寫，店長在截止後統一確認。本頁目前僅供檢視，尚未開放核准。</p></div>
  <label className="flex items-center gap-3">查看月份
   <input aria-label="查看月份" type="month" value={month} onChange={e=>setMonth(e.target.value)}
    className="rounded-lg border border-border bg-surface p-2"/></label>
  {loading?<p role="status">正在讀取申請…</p>:error?<p role="alert" className="text-red-700">讀取失敗：{error}</p>:
   <><div className="rounded-xl border border-border bg-surface p-4">
    <strong>本月共 {rows.length} 筆申請，其中 {rows.filter(r=>r.status==="pending").length} 筆待確認</strong>
    <p className="mt-2 text-sm text-secondary-text">此清單不代表人力已達標。核准前仍須確認每日最低人力、班表與預約衝突。</p>
   </div>
   {grouped.length===0?<p>這個月尚無休假申請。</p>:grouped.map(([date,items])=>
    <div key={date} className="rounded-xl border border-border bg-surface p-4">
     <h2 className="mb-3 font-semibold">{date} · {items.length} 筆</h2>
     <ul className="space-y-3">{items.map(row=><li key={row.id} className="border-t border-border pt-3 text-sm">
      <span className="font-medium">員工編號：{row.staff_membership_id}</span>
      <span className="ml-3">{row.status==="pending"?"待確認":row.status==="approved"?"已核准":row.status==="rejected"?"已駁回":"已取消"}</span>
      {row.reason?<p className="mt-1 text-secondary-text">備註：{row.reason}</p>:null}
     </li>)}</ul>
    </div>)}</>}
 </section>;
}
