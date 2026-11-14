"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  DEFAULT_CONSULTATION_FIELDS,
  type ConsultationField,
  type ConsultationFieldType,
  type ConsultationSection,
} from "@/lib/consultation-settings";

const TYPE_LABELS: Record<ConsultationFieldType, string> = {
  single: "單選", multi: "多選", text: "文字輸入", date: "日期", rating: "星級評分",
};
const SECTION_LABELS: Record<ConsultationSection, string> = {
  assessment: "今日評估", professionalNote: "專業紀錄",
};
const inputClass = "min-h-11 w-full rounded-xl border border-border bg-background px-3 py-2 text-sm text-text";
const buttonClass = "min-h-11 rounded-xl border border-border px-4 py-2 text-sm text-text hover:bg-primary-light";

export default function ConsultationSettingsPage() {
  const { organization, membership } = useOrganization();
  const [fields, setFields] = useState<ConsultationField[]>(DEFAULT_CONSULTATION_FIELDS);
  const [selectedId, setSelectedId] = useState("suitable-products");
  const [newOption, setNewOption] = useState("");
  const [status, setStatus] = useState("");
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadFailed(false);
    setStatus("");
    fetch(`/api/staff/consultation-settings?organizationId=${encodeURIComponent(organization.id)}`, { cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "讀取失敗"); return result; })
      .then((result) => { if (!cancelled) { setFields(result.fields); setRevision(result.revision); setSelectedId(result.fields[0]?.id ?? ""); } })
      .catch((error) => { if (!cancelled) { setLoadFailed(true); setStatus(`無法載入雲端設定：${error instanceof Error ? error.message : "讀取失敗"}。請先重新整理，不要儲存預設值。`); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [organization.id]);
  const canManage = membership?.role === "OWNER" || membership?.role === "MANAGER";
  const selected = fields.find((field) => field.id === selectedId);
  const patch = (update: Partial<ConsultationField>) => {
    setFields((prev) => prev.map((field) => field.id === selectedId ? { ...field, ...update } : field));
    setStatus("");
  };
  if (!canManage) return <p className="text-secondary-text">只有店長或主管可以管理諮詢設定。</p>;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <header>
        <h1 className="text-2xl font-semibold text-text">諮詢設定</h1>
        <p className="mt-2 text-sm text-secondary-text">自訂今日評估與專業紀錄的欄位、選項與填寫方式。</p>
        <p className="mt-1 text-xs text-secondary-text">設定儲存於 Supabase，同一家店的其他裝置重新開啟即可讀取。療程紀錄將依店家儲存的欄位設定顯示。</p>
      </header>
      {loading ? <p className="text-secondary-text">正在讀取雲端設定…</p> : <div className="grid gap-5 md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
        <section className="space-y-2 rounded-2xl border border-border bg-surface p-4">
          <h2 className="font-semibold text-text">諮詢欄位</h2>
          {fields.map((field) => (
            <button key={field.id} type="button" onClick={() => { setSelectedId(field.id); setNewOption(""); }}
              className={`w-full rounded-xl px-3 py-3 text-left text-sm ${selectedId === field.id ? "bg-primary-light text-primary" : "text-text hover:bg-background"}`}>
              {field.label} <span className="block text-xs opacity-70">{SECTION_LABELS[field.section]} · {TYPE_LABELS[field.type]}{!field.enabled ? " · 已停用" : ""}</span>
            </button>
          ))}
          <button className={buttonClass} type="button" onClick={() => {
            const id = crypto.randomUUID();
            setFields((prev) => [...prev, { id, label: "新諮詢欄位", section: "assessment", type: "multi", options: [], enabled: true }]);
            setSelectedId(id);
            setStatus("");
          }}>＋ 新增欄位</button>
        </section>
        {selected ? <section className="space-y-4 rounded-2xl border border-border bg-surface p-4">
          <label className="block space-y-2 text-sm font-medium text-text">欄位名稱
            <input className={inputClass} value={selected.label} onChange={(e) => patch({ label: e.target.value })} />
          </label>
          <label className="block space-y-2 text-sm font-medium text-text">所屬區塊
            <select className={inputClass} value={selected.section} onChange={(e) => patch({ section: e.target.value as ConsultationSection })}>
              {Object.entries(SECTION_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="block space-y-2 text-sm font-medium text-text">填寫方式
            <select className={inputClass} value={selected.type} onChange={(e) => patch({ type: e.target.value as ConsultationFieldType })}>
              {Object.entries(TYPE_LABELS).map(([value,label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </label>
          <label className="flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={selected.enabled} onChange={(e) => patch({ enabled: e.target.checked })} /> 啟用欄位
          </label>
          {(selected.type === "multi" || selected.type === "single") && <div className="space-y-3">
            <h3 className="font-medium text-text">選項管理</h3>
            {selected.options.map((option, index) => <div className="flex gap-2" key={index}>
              <input aria-label={`選項 ${index + 1}`} className={inputClass} value={option} onChange={(e) => patch({ options: selected.options.map((item,i) => i === index ? e.target.value : item) })} />
              <button type="button" className={buttonClass} aria-label={`刪除 ${option}`} onClick={() => patch({ options: selected.options.filter((_,i) => i !== index) })}>刪除</button>
            </div>)}
            <div className="flex gap-2">
              <input className={inputClass} value={newOption} placeholder="輸入新選項" onChange={(e) => setNewOption(e.target.value)} />
              <button type="button" className={buttonClass} disabled={!newOption.trim() || selected.options.includes(newOption.trim())}
                onClick={() => { patch({ options: [...selected.options, newOption.trim()] }); setNewOption(""); }}>新增</button>
            </div>
          </div>}
          <div className="flex flex-wrap gap-2 border-t border-border pt-4">
            <button type="button" className={buttonClass} onClick={() => {
              const index = fields.findIndex((field) => field.id === selectedId);
              if (index < 1) return;
              setFields((prev) => { const copy = [...prev]; [copy[index - 1], copy[index]] = [copy[index], copy[index - 1]]; return copy; });
              setStatus("");
            }}>向上排序</button>
            <button type="button" className={buttonClass} onClick={() => {
              const index = fields.findIndex((field) => field.id === selectedId);
              if (index < 0 || index >= fields.length - 1) return;
              setFields((prev) => { const copy = [...prev]; [copy[index + 1], copy[index]] = [copy[index], copy[index + 1]]; return copy; });
              setStatus("");
            }}>向下排序</button>
            <button type="button" className={buttonClass} onClick={() => {
              setFields((prev) => prev.filter((field) => field.id !== selectedId));
              setSelectedId(fields.find((field) => field.id !== selectedId)?.id ?? "");
              setStatus("");
            }}>移除欄位</button>
          </div>
        </section> : null}
      </div>}
      <div className="flex items-center gap-3">
        <button disabled={loading || saving || loadFailed} type="button" className="min-h-11 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-white" onClick={async () => {
          if (fields.some((field) => !field.label.trim() || ((field.type === "multi" || field.type === "single") && new Set(field.options.map((o) => o.trim())).size !== field.options.length))) {
            setStatus("請確認欄位名稱與選項內容，不能空白或重複。"); return;
          }
          setSaving(true);
          try {
            const response = await fetch("/api/staff/consultation-settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ organizationId: organization.id, fields, revision }) });
            const result = await response.json();
            if (!response.ok) throw new Error(`${result.error ?? "儲存失敗"}（HTTP ${response.status}）`);
            setRevision(result.revision);
            setStatus("已同步至 Supabase");
          } catch (error) { setStatus(error instanceof Error ? error.message : "儲存失敗"); }
          finally { setSaving(false); }
        }}>儲存設定</button>
        <span role="status" className="text-sm text-secondary-text">{status}</span>
      </div>
    </div>
  );
}
