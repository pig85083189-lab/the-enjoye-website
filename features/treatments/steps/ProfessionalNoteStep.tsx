"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { QuickSelect } from "@/components/treatments/QuickSelect";
import { StepFooter } from "@/features/treatments/StepFooter";
import { composeNoteFromPhrases } from "@/lib/treatment-draft";
import { CLIENT_FEELINGS } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";
import { cn } from "@/lib/utils";

interface ProfessionalNoteStepProps {
  template: TreatmentTemplate;
  isQuickMode: boolean;
  professionalNote: string;
  selectedQuickPhrases: string[];
  noteManuallyEdited: boolean;
  clientFeeling: string;
  discomfortNote: string;
  onUpdate: (
    patch: Partial<{
      professionalNote: string;
      selectedQuickPhrases: string[];
      noteManuallyEdited: boolean;
      clientFeeling: string;
      discomfortNote: string;
    }>,
  ) => void;
  onBack: () => void;
  onNext: () => void;
  onJumpToComplete: () => void;
}

export function ProfessionalNoteStep({
  template,
  isQuickMode,
  professionalNote,
  selectedQuickPhrases,
  noteManuallyEdited,
  clientFeeling,
  discomfortNote,
  onUpdate,
  onBack,
  onNext,
  onJumpToComplete,
}: ProfessionalNoteStepProps) {
  function togglePhrase(phrase: string) {
    const selected = selectedQuickPhrases.includes(phrase)
      ? selectedQuickPhrases.filter((item) => item !== phrase)
      : [...selectedQuickPhrases, phrase];

    if (noteManuallyEdited) {
      onUpdate({ selectedQuickPhrases: selected });
      return;
    }

    onUpdate({
      selectedQuickPhrases: selected,
      professionalNote: composeNoteFromPhrases(selected, template.quickPhraseTextMap),
    });
  }

  return (
    <div>
      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-text">美容師專業紀錄</h1>
        {isQuickMode ? (
          <p className="mt-2 rounded-2xl bg-primary-light/50 px-4 py-3 text-sm text-text">
            已沿用基本紀錄，請確認今天實際服務狀況。
          </p>
        ) : null}
      </header>

      <Card padding="md">
        <p className="text-base font-semibold text-text">快速片語</p>
        <p className="mt-1 text-sm text-secondary-text">
          點選後自動組成草稿文字，仍可自由修改
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {template.quickPhrases.map((phrase) => {
            const selected = selectedQuickPhrases.includes(phrase);
            return (
              <button
                key={phrase}
                type="button"
                aria-pressed={selected}
                onClick={() => togglePhrase(phrase)}
                className={cn(
                  "min-h-11 rounded-full border px-3.5 text-sm font-medium transition-colors",
                  selected
                    ? "border-primary bg-primary-light text-primary"
                    : "border-border bg-surface text-secondary-text hover:border-primary/40",
                )}
              >
                {phrase}
              </button>
            );
          })}
        </div>

        <label htmlFor="professional-note" className="mt-5 block text-base font-semibold text-text">
          服務紀錄
        </label>
        <textarea
          id="professional-note"
          value={professionalNote}
          onChange={(event) =>
            onUpdate({
              professionalNote: event.target.value,
              noteManuallyEdited: true,
            })
          }
          rows={6}
          className="mt-3 w-full rounded-2xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary"
          placeholder="今天右側腋下較緊，胸上緣循環較差，操作後柔軟度改善，下次建議持續加強右側腋下與胸上緣。"
        />
      </Card>

      <Card padding="md" className="mt-4">
        <h2 className="text-base font-semibold text-text">客人療程後感受</h2>
        <p className="mt-1 text-sm text-secondary-text">單選</p>
        <QuickSelect
          className="mt-3"
          options={[...CLIENT_FEELINGS]}
          value={clientFeeling ? [clientFeeling] : []}
          multiple={false}
          onChange={(next) =>
            onUpdate({
              clientFeeling: next[0] ?? "",
              discomfortNote: next[0] === "不舒服" ? discomfortNote : "",
            })
          }
        />

        {clientFeeling === "不舒服" ? (
          <label className="mt-4 block">
            <span className="text-sm font-medium text-text">
              請記錄客人不舒服的部位或情況
            </span>
            <textarea
              value={discomfortNote}
              onChange={(event) => onUpdate({ discomfortNote: event.target.value })}
              rows={3}
              required
              className="mt-1.5 w-full rounded-2xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary"
              placeholder="請簡述不適位置與狀況"
            />
          </label>
        ) : null}
      </Card>

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        nextLabel="下一步：下次追蹤"
        extra={
          <Button variant="secondary" onClick={onJumpToComplete} className="min-h-12">
            前往完成確認
          </Button>
        }
      />
    </div>
  );
}
