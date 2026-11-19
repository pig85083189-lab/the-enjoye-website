"use client";

import { useEffect, useState } from "react";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import { listStoredCompletedTreatments } from "@/lib/treatment-draft";
import { migrateCompletedBrowserTreatment } from "@/lib/treatments/completed-treatment-migration";
import { TREATMENT_REMOTE_READ_PILOT_ENV } from "@/lib/treatments/treatment-remote-read-flag";
import { TREATMENT_REMOTE_WRITE_PILOT_ENV } from "@/lib/treatments/treatment-remote-write-flag";
import type { TreatmentWriteClient } from "@/lib/treatments/treatment-remote-write-pilot";

export function CompletedTreatmentMigrationPanel({ organizationId }: {
  organizationId: string;
}) {
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<ReturnType<typeof listStoredCompletedTreatments>>([]);
  useEffect(() => {
    setRecords(listStoredCompletedTreatments(organizationId));
  }, [organizationId]);
  const current = records.find((item) => item.id === selected);
  async function submit() {
    if (!current || !confirmed || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const client = createBrowserClientOrNull() as TreatmentWriteClient | null;
      if (!client) throw new Error("無法取得 Supabase 登入工作階段");
      const completed = await migrateCompletedBrowserTreatment(client, current, {
        [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
        [TREATMENT_REMOTE_WRITE_PILOT_ENV]: "1",
      }, listStoredCompletedTreatments(organizationId));
      setMessage(`已寫入並重新驗證：${completed.id}。本機原始紀錄仍保留。`);
      setRecords(listStoredCompletedTreatments(organizationId));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "補同步失敗，原始資料已保留");
    } finally {
      setBusy(false);
      setConfirmed(false);
    }
  }
  return (
    <section aria-label="主管舊療程補同步" className="mb-4 rounded-xl border border-border p-4">
      <h2 className="text-sm font-semibold">主管舊療程補同步</h2>
      <p className="mt-1 text-xs text-secondary-text">僅限主管操作。一次選一筆，先核對原始紀錄。失敗不刪除本機資料。</p>
      <select
        aria-label="選擇本機已完成療程"
        className="mt-3 w-full rounded-lg border border-border p-2 text-sm"
        value={selected}
        onChange={(event) => { setSelected(event.target.value); setConfirmed(false); setMessage(""); }}
      >
        <option value="">請選擇本機已完成療程</option>
        {records.map((item) => (
          <option key={item.id} value={item.id}>
            {item.updatedAt.slice(0, 10)} · {item.appointmentId}
          </option>
        ))}
      </select>
      {current && (
        <p className="mt-2 text-xs text-secondary-text">療程 ID：{current.id} · 顧客 ID：{current.customerId}</p>
      )}
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} />
        我已確認這是要補同步的原始療程
      </label>
      <button
        type="button"
        className="mt-3 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-50"
        disabled={!current || !confirmed || busy}
        onClick={() => void submit()}
      >
        {busy ? "正在驗證與同步…" : "確認補同步這一筆"}
      </button>
      {message && <p role="status" className="mt-3 text-sm">{message}</p>}
    </section>
  );
}
