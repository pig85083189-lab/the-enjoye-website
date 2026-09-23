"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QuickSelect } from "@/components/treatments/QuickSelect";
import { StepFooter } from "@/features/treatments/StepFooter";
import { suggestFollowUpFromSession } from "@/lib/treatment-hints";
import type { TreatmentDraft, TreatmentFollowUp } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";

interface FollowUpStepProps {
  template: TreatmentTemplate;
  draft: TreatmentDraft;
  value: TreatmentFollowUp;
  onChange: (next: TreatmentFollowUp) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function FollowUpStep({
  template,
  draft,
  value,
  onChange,
  onBack,
  onNext,
  onSkip,
}: FollowUpStepProps) {
  const [suggestedPreview, setSuggestedPreview] = useState<string[] | null>(null);

  function proposeFromSession() {
    const suggested = suggestFollowUpFromSession(draft, template);
    setSuggestedPreview(suggested);
  }

  function applySuggested() {
    if (!suggestedPreview) return;
    const merged = Array.from(new Set([...value.tags, ...suggestedPreview]));
    onChange({ ...value, tags: merged });
    setSuggestedPreview(null);
  }

  return (
    <div>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-text">下次追蹤</h1>
          <span className="rounded-full bg-[#F3EEEC] px-2.5 py-1 text-xs text-secondary-text">
            選填
          </span>
        </div>
        <p className="mt-2 text-[15px] text-secondary-text">標記下次服務需要特別留意的重點</p>
      </header>

      <Card padding="md" className="mb-4">
        <h2 className="text-base font-semibold text-text">快速設定</h2>
        <p className="mt-1 text-sm text-secondary-text">
          從本次評估與部位標記產生建議，確認後再套用
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={proposeFromSession}>
            沿用本次需要注意的部位
          </Button>
        </div>
        {suggestedPreview ? (
          <div className="mt-4 rounded-2xl bg-primary-light/50 px-4 py-3">
            <p className="text-sm text-text">
              建議追蹤：
              {suggestedPreview.length > 0 ? suggestedPreview.join("、") : "尚無明確建議"}
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button onClick={applySuggested} disabled={suggestedPreview.length === 0}>
                確認套用
              </Button>
              <Button variant="ghost" onClick={() => setSuggestedPreview(null)}>
                取消
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card padding="md">
        <h2 className="text-base font-semibold text-text">追蹤重點</h2>
        <QuickSelect
          className="mt-3"
          options={template.followUpOptions}
          value={value.tags}
          onChange={(tags) => onChange({ ...value, tags })}
        />
      </Card>

      <Card padding="md" className="mt-4">
        <label htmlFor="suggested-date" className="text-base font-semibold text-text">
          下次建議日期
        </label>
        <p className="mt-1 text-sm text-secondary-text">非必填</p>
        <input
          id="suggested-date"
          type="date"
          value={value.suggestedDate}
          onChange={(event) => onChange({ ...value, suggestedDate: event.target.value })}
          className="mt-3 h-12 w-full max-w-xs rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary"
        />
      </Card>

      <Card padding="md" className="mt-4">
        <label htmlFor="follow-up-note" className="text-base font-semibold text-text">
          追蹤備註
        </label>
        <textarea
          id="follow-up-note"
          value={value.note}
          onChange={(event) => onChange({ ...value, note: event.target.value })}
          rows={3}
          className="mt-3 w-full rounded-2xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary"
          placeholder="例如：下次確認右側腋下與胸上緣狀況。"
        />
      </Card>

      <Card padding="md" className="mt-4">
        <label className="flex min-h-12 cursor-pointer items-center gap-3">
          <input
            type="checkbox"
            checked={value.suggestNextBooking}
            onChange={(event) =>
              onChange({ ...value, suggestNextBooking: event.target.checked })
            }
            className="h-5 w-5 rounded border-border accent-primary"
          />
          <span className="text-[15px] font-medium text-text">建議下次預約</span>
        </label>
      </Card>

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        onSkip={onSkip}
        nextLabel="下一步：完成確認"
      />
    </div>
  );
}
