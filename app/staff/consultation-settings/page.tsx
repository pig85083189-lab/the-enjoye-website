"use client";

import { useEffect, useState } from "react";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  DEFAULT_CONSULTATION_FIELDS,
  loadConsultationFields,
  saveConsultationFields,
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
  useEffect(() => {
    setFields(loadConsultationFields(organization.id));
    setSelectedId("suitable-products");
    setStatus("");
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
        <p className="mt-1 text-xs text-secondary-text">目前為開發階段：設定僅保存在這台裝置，尚未同步 Supabase 或套用到療程紀錄。</p>
      </header>
      <div className="grid gap-5 md:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
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
      </div>
      <div className="flex items-center gap-3">
        <button type="button" className="min-h-11 rounded-xl bg-primary px-5 py-2 text-sm font-medium text-white" onClick={() => {
          if (fields.some((field) => !field.label.trim() || ((field.type === "multi" || field.type === "single") && new Set(field.options.map((o) => o.trim())).size !== field.options.length))) {
            setStatus("請確認欄位名稱與選項內容，不能空白或重複。"); return;
          }
          try { saveConsultationFields(organization.id, fields); setStatus("已儲存於此裝置（尚未同步雲端）"); }
          catch { setStatus("儲存失敗，請檢查瀏覽器儲存空間。"); }
        }}>儲存設定</button>
        <span role="status" className="text-sm text-secondary-text">{status}</span>
      </div>
    </div>
  );
}
