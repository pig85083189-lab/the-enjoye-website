"use client";

import { BodyMap } from "@/components/treatments/BodyMap";
import { Card } from "@/components/ui/Card";
import { StepFooter } from "@/features/treatments/StepFooter";
import type { BodyMarker } from "@/types/treatment";
import type { TreatmentTemplate } from "@/types/treatment-template";

interface BodyMapStepProps {
  template: TreatmentTemplate;
  markers: BodyMarker[];
  bodyMapNote: string;
  suggestedTrackingAreas: string[];
  onMarkersChange: (markers: BodyMarker[]) => void;
  onNoteChange: (note: string) => void;
  onBack: () => void;
  onNext: () => void;
  onSkip: () => void;
}

export function BodyMapStep({
  template,
  markers,
  bodyMapNote,
  suggestedTrackingAreas,
  onMarkersChange,
  onNoteChange,
  onBack,
  onNext,
  onSkip,
}: BodyMapStepProps) {
  return (
    <div>
      <header className="mb-5">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold text-text">部位紀錄</h1>
          <span className="rounded-full bg-[#F3EEEC] px-2.5 py-1 text-xs text-secondary-text">
            選填
          </span>
        </div>
        <p className="mt-2 text-[15px] leading-relaxed text-secondary-text">
          點選簡約部位圖標記今日需要關注的區域。
        </p>
      </header>

      <BodyMap
        mapType={template.bodyMapType}
        areas={template.bodyAreas}
        conditions={template.bodyConditions}
        markers={markers}
        suggestedTrackingAreas={suggestedTrackingAreas}
        onChange={onMarkersChange}
      />

      <Card padding="md" className="mt-4">
        <label htmlFor="body-map-note" className="text-base font-semibold text-text">
          部位備註
        </label>
        <textarea
          id="body-map-note"
          value={bodyMapNote}
          onChange={(event) => onNoteChange(event.target.value)}
          rows={3}
          className="mt-3 w-full rounded-2xl border border-border bg-background px-4 py-3 text-[15px] outline-none focus:border-primary"
          placeholder="例如：右側腋下較緊，胸上緣循環較差。"
        />
      </Card>

      <StepFooter
        onBack={onBack}
        onNext={onNext}
        onSkip={onSkip}
        nextLabel="下一步：操作項目"
      />
    </div>
  );
}
