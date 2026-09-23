"use client";

import { PageHeader } from "@/components/ui/PageHeader";
import { Card } from "@/components/ui/Card";

interface ModulePlaceholderProps {
  title: string;
  description: string;
  phaseHint?: string;
}

/** Non-fake placeholder for modules not yet implemented. */
export function ModulePlaceholder({
  title,
  description,
  phaseHint = "此模組為 Information Architecture 預留頁面，尚未連接真實業務資料。",
}: ModulePlaceholderProps) {
  return (
    <div className="space-y-5">
      <PageHeader title={title} description={description} />
      <Card padding="lg" className="space-y-3">
        <p className="text-[15px] leading-relaxed text-secondary-text">{phaseHint}</p>
        <p className="text-xs text-secondary-text">
          Placeholder · 不產生假營收 / 假庫存 / 假報表數字
        </p>
      </Card>
    </div>
  );
}
