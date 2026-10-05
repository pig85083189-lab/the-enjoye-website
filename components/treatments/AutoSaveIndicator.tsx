"use client";

import { cn } from "@/lib/utils";

interface AutoSaveIndicatorProps {
  savedAt: Date | null;
  saving?: boolean;
  error?: boolean;
}

export function AutoSaveIndicator({ savedAt, saving, error }: AutoSaveIndicatorProps) {
  if (error) {
    return (
      <p className="text-xs text-[#C56B70]" role="alert">
        儲存失敗，請重試
      </p>
    );
  }

  if (saving) {
    return (
      <p className="text-xs text-secondary-text" aria-live="polite">
        儲存中…
      </p>
    );
  }

  if (!savedAt) return null;

  const time = savedAt.toLocaleTimeString("zh-TW", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <p
      className="inline-flex items-center gap-1.5 text-xs text-secondary-text"
      aria-live="polite"
    >
      ✓ 已自動儲存 {time}
    </p>
  );
}

interface TreatmentProgressProps {
  currentIndex: number;
  total: number;
  label: string;
}

export function TreatmentProgress({ currentIndex, total, label }: TreatmentProgressProps) {
  const percent = Math.round(((currentIndex + 1) / total) * 100);

  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-secondary-text">
          步驟 {currentIndex + 1} / {total}
        </p>
        <p className="truncate text-sm font-medium text-text">{label}</p>
      </div>
      <div
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-valuenow={currentIndex + 1}
        aria-valuemin={1}
        aria-valuemax={total}
        aria-label={`療程進度 ${currentIndex + 1} / ${total}`}
      >
        <div
          className={cn("h-full rounded-full bg-primary transition-[width] duration-300")}
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}
