"use client";

import type { ConsultationField } from "@/lib/consultation-settings";

interface Props {
  fields: ConsultationField[];
  values: Record<string, string | string[]>;
  onChange: (id: string, value: string | string[]) => void;
}
export function ConsultationFields({ fields, values, onChange }: Props) {
  return <div className="space-y-4">
    {fields.filter((field) => field.enabled).map((field) => {
      const value = values[field.id];
      const choices = Array.isArray(value) ? value : typeof value === "string" && value ? [value] : [];
      return <div key={field.id} className="rounded-2xl border border-border bg-surface p-4">
        <label className="mb-3 block text-base font-semibold text-text">{field.label}</label>
        {field.type === "single" || field.type === "multi" ? <div className="flex flex-wrap gap-2">
          {field.options.map((option) => {
            const selected = choices.includes(option);
            return <button key={option} type="button" aria-pressed={selected}
              className={`min-h-11 rounded-full border px-3.5 text-sm ${selected ? "border-primary bg-primary-light text-primary" : "border-border text-secondary-text"}`}
              onClick={() => onChange(field.id, field.type === "single" ? (selected ? "" : option) : selected ? choices.filter((item) => item !== option) : [...choices, option])}>
              {option}
            </button>;
          })}
          {field.options.length === 0 ? <p className="text-sm text-secondary-text">店長尚未設定選項</p> : null}
        </div> : field.type === "rating" ? <div className="flex gap-2" role="radiogroup" aria-label={field.label}>
          {[1,2,3,4,5].map((star) => <button key={star} type="button" role="radio" aria-checked={Number(value) === star}
            aria-label={`${star} 顆星`} className="min-h-11 min-w-11 text-2xl text-primary"
            onClick={() => onChange(field.id, String(star))}>{star <= Number(value ?? 0) ? "★" : "☆"}</button>)}
        </div> : field.type === "date" ? <input type="date" aria-label={field.label} value={typeof value === "string" ? value : ""}
          onChange={(event) => onChange(field.id, event.target.value)}
          className="min-h-11 rounded-xl border border-border bg-background px-3 text-text" /> :
          <textarea aria-label={field.label} value={typeof value === "string" ? value : ""}
            onChange={(event) => onChange(field.id, event.target.value)} rows={3}
            className="w-full rounded-xl border border-border bg-background p-3 text-text" />}
      </div>;
    })}
  </div>;
}
