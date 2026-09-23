"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QuickSelect } from "@/components/treatments/QuickSelect";
import { StepFooter } from "@/features/treatments/StepFooter";
import type { PreviousTreatmentHints } from "@/lib/treatment-hints";
import { SENSITIVITY_LEVELS } from "@/types/treatment";
import type { TreatmentAssessment } from "@/types/treatment";
import type { AssessmentComparison, TreatmentTemplate } from "@/types/treatment-template";
import { cn } from "@/lib/utils";

interface AssessmentStepProps {
  template: TreatmentTemplate;
  value: TreatmentAssessment;
  previousHints: PreviousTreatmentHints;
  onChange: (next: TreatmentAssessment) => void;
  onBack: () => void;
  onNext: () => void;
}

const COMPARISON_OPTIONS: Array<{ value: AssessmentComparison; label: string }> = [
  { value: "same_as_last", label: "大致相同" },
  { value: "new_conditions", label: "有新的狀況" },
  { value: "improved", label: "有改善" },
  { value: "needs_attention", label: "需要特別注意" },
];

export function AssessmentStep({
  template,
  value,
  previousHints,
  onChange,
  onBack,
  onNext,
}: AssessmentStepProps) {
  const comparison = value.comparisonToLast ?? "";

  function applyPrevious() {
    const concerns =
      previousHints.concerns.length > 0
        ? previousHints.concerns
        : previousHints.followUpTags.filter((tag) =>
            template.assessmentOptions.includes(tag),
          );
    onChange({
      ...value,
      comparisonToLast: "same_as_last",
      concerns: concerns.length > 0 ? concerns : value.concerns,
    });
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-text">今日評估</h1>
        <p className="mt-2 text-[15px] leading-relaxed text-secondary-text">
          快速記錄客人今天的狀況，完成後可隨時返回修改。
        </p>
      </header>

      <Card padding="md">
        <h2 className="text-base font-semibold text-text">今天的狀況和上次相比？</h2>
        <div
          className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4"
          role="radiogroup"
          aria-label="與上次比較"
        >
          {COMPARISON_OPTIONS.map((option) => {
            const selected = comparison === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...value, comparisonToLast: option.value })}
                className={cn(
                  "min-h-12 rounded-2xl border px-3 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border bg-surface text-secondary-text hover:border-primary/40",
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        {comparison === "same_as_last" ? (
          <div className="mt-4 rounded-2xl bg-primary-light/50 px-4 py-3">
            <p className="text-sm text-text">已沿用上次追蹤重點</p>
            <p className="mt-1 text-xs text-secondary-text">
              {previousHints.source === "completed"
                ? "來源：上次療程紀錄"
                : "來源：客戶追蹤重點"}
            </p>
            <Button className="mt-3" variant="secondary" onClick={applyPrevious}>
              沿用上次狀況
            </Button>
          </div>
        ) : null}
      </Card>

      <Card padding="md" className="mt-4">
        <h2 className="text-base font-semibold text-text">{template.name}</h2>
        <p className="mt-1 text-sm text-secondary-text">可複選今日觀察到的狀況</p>
        <QuickSelect
          className="mt-4"
          options={template.assessmentOptions}
          value={value.concerns}
          onChange={(concerns) => onChange({ ...value, concerns })}
        />
      </Card>

      <Card padding="md" className="mt-4">
        <label htmlFor="client-focus" className="text-base font-semibold text-text">
          客人今天最在意什麼？
        </label>
        <textarea
          id="client-focus"
          value={value.clientFocus}
          onChange={(event) => onChange({ ...value, clientFocus: event.target.value })}
          rows={4}
          className="mt-3 w-full rounded-2xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary"
          placeholder="例如：最近覺得右側比較緊，希望今天加強腋下與胸上緣。"
        />
      </Card>

      <Card padding="md" className="mt-4">
        <h2 className="text-base font-semibold text-text">疼痛 / 敏感程度</h2>
        <p className="mt-1 text-sm text-secondary-text">僅供服務參考，非醫療診斷</p>
        <div
          className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6"
          role="radiogroup"
          aria-label="疼痛敏感程度"
        >
          {SENSITIVITY_LEVELS.map((level) => {
            const selected = value.sensitivityLevel === level.value;
            return (
              <button
                key={level.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ ...value, sensitivityLevel: level.value })}
                className={cn(
                  "min-h-12 rounded-2xl border text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border bg-surface text-secondary-text hover:border-primary/40",
                )}
              >
                {level.label}
              </button>
            );
          })}
        </div>
      </Card>

      <StepFooter onBack={onBack} onNext={onNext} nextLabel="下一步：部位紀錄" />
    </div>
  );
}
