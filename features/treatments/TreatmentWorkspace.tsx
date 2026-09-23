"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AutoSaveIndicator,
  TreatmentProgress,
} from "@/components/treatments/AutoSaveIndicator";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useLeaveGuard } from "@/features/treatments/LeaveGuard";
import { TreatmentNavigation } from "@/features/treatments/TreatmentNavigation";
import { AssessmentStep } from "@/features/treatments/steps/AssessmentStep";
import { BodyMapStep } from "@/features/treatments/steps/BodyMapStep";
import { CompleteStep } from "@/features/treatments/steps/CompleteStep";
import { CustomerSummaryStep } from "@/features/treatments/steps/CustomerSummaryStep";
import { FollowUpStep } from "@/features/treatments/steps/FollowUpStep";
import { OperationsStep } from "@/features/treatments/steps/OperationsStep";
import { PhotosStep } from "@/features/treatments/steps/PhotosStep";
import { ProfessionalNoteStep } from "@/features/treatments/steps/ProfessionalNoteStep";
import { useTreatmentDraft } from "@/hooks/useTreatmentDraft";
import { getTreatmentTemplateForService } from "@/data/treatment-templates";
import { setAppointmentStatus } from "@/lib/appointment-store";
import {
  getPreviousTreatmentHints,
  mapFollowUpToSuggestedAreas,
} from "@/lib/treatment-hints";
import { saveCompletedTreatment, stepIndex } from "@/lib/treatment-draft";
import type { Appointment, Customer } from "@/types";
import {
  TREATMENT_STEPS,
  isOptionalStep,
  type TreatmentStepId,
} from "@/types/treatment";
import { cn } from "@/lib/utils";

interface TreatmentWorkspaceProps {
  customer: Customer;
  appointment: Appointment;
}

const STEP_ORDER = TREATMENT_STEPS.map((step) => step.id);

export function TreatmentWorkspace({ customer, appointment }: TreatmentWorkspaceProps) {
  const router = useRouter();
  const { setBlocked } = useLeaveGuard();
  const [finished, setFinished] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [quickBanner, setQuickBanner] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const template = useMemo(
    () =>
      getTreatmentTemplateForService(appointment.serviceId, appointment.organizationId),
    [appointment.serviceId, appointment.organizationId],
  );

  const previousHints = useMemo(
    () => getPreviousTreatmentHints(customer, template),
    [customer, template],
  );

  const {
    draft,
    photos,
    setPhotos,
    updateDraft,
    setStep,
    savedAt,
    hasContent,
    hydrated,
  } = useTreatmentDraft({
    organizationId: appointment.organizationId,
    locationId: appointment.locationId,
    appointmentId: appointment.id,
    customerId: customer.id,
    staffId: appointment.staffId,
    serviceId: appointment.serviceId,
  });

  useEffect(() => {
    if (appointment.status !== "completed" && appointment.status !== "in_progress") {
      setAppointmentStatus(appointment.id, "in_progress", appointment.organizationId);
    }
  }, [appointment.id, appointment.organizationId, appointment.status]);

  useEffect(() => {
    setBlocked(hasContent && !finished);
    return () => setBlocked(false);
  }, [hasContent, finished, setBlocked]);

  useEffect(() => {
    if (!hasContent || finished) return;
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasContent, finished]);

  const currentIdx = stepIndex(draft.currentStep);
  const currentMeta = TREATMENT_STEPS[currentIdx] ?? TREATMENT_STEPS[0];

  function goTo(step: TreatmentStepId) {
    setCompleteError("");
    setMobileMenuOpen(false);
    updateDraft((prev) => {
      const prevFurthest = prev.furthestStep ?? prev.currentStep;
      const nextFurthest =
        stepIndex(step) > stepIndex(prevFurthest) ? step : prevFurthest;
      // visiting a skipped step removes skip mark so user can fill it
      const skippedSteps = prev.skippedSteps.filter((id) => id !== step);
      return { ...prev, currentStep: step, furthestStep: nextFurthest, skippedSteps };
    });
  }

  function goNext() {
    const next = STEP_ORDER[currentIdx + 1];
    if (next) goTo(next);
  }

  function goBack() {
    setCompleteError("");
    const prev = STEP_ORDER[currentIdx - 1];
    if (prev) setStep(prev);
  }

  function skipStep(step: TreatmentStepId) {
    if (!isOptionalStep(step)) return;
    updateDraft((prev) => {
      const skipped = Array.from(new Set([...prev.skippedSteps, step]));
      const nextIdx = stepIndex(step) + 1;
      const nextStep = STEP_ORDER[nextIdx] ?? "complete";
      const nextFurthest =
        stepIndex(nextStep) > stepIndex(prev.furthestStep ?? prev.currentStep)
          ? nextStep
          : (prev.furthestStep ?? prev.currentStep);
      return {
        ...prev,
        skippedSteps: skipped,
        currentStep: nextStep,
        furthestStep: nextFurthest,
      };
    });
  }

  function applyQuickRecord() {
    const concerns =
      previousHints.assessment?.concerns ??
      previousHints.concerns;
    const followUp =
      previousHints.followUp ??
      (previousHints.followUpTags.length > 0
        ? {
            tags: previousHints.followUpTags,
            suggestedDate: "",
            note: "",
            suggestNextBooking: false,
          }
        : {
            tags: [],
            suggestedDate: "",
            note: "",
            suggestNextBooking: false,
          });

    const products = previousHints.products;
    const operations = [...template.standardProtocol];
    const selectedQuickPhrases = template.quickPhrases.includes("建議持續追蹤")
      ? ["建議持續追蹤"]
      : [];
    const suggestedTrackingAreas = mapFollowUpToSuggestedAreas(
      followUp.tags.length > 0 ? followUp.tags : previousHints.followUpTags,
      template,
    );

    updateDraft((prev) => ({
      ...prev,
      mode: "QUICK",
      quickRecordAppliedAt: new Date().toISOString(),
      currentStep: "professionalNote",
      furthestStep: "professionalNote",
      skippedSteps: prev.skippedSteps.filter(
        (id) => id !== "bodyMap" && id !== "photos" && id !== "followUp",
      ),
      assessment: {
        concerns,
        clientFocus: previousHints.assessment?.clientFocus ?? "",
        sensitivityLevel: previousHints.assessment?.sensitivityLevel ?? 0,
        comparisonToLast: "same_as_last",
      },
      operations,
      products,
      bodyMarkers: [],
      photos: [],
      professionalNote: "",
      noteManuallyEdited: false,
      selectedQuickPhrases,
      clientFeeling: "",
      discomfortNote: "",
      followUp,
      suggestedTrackingAreas,
    }));
    setPhotos([]);
    setQuickBanner(
      `已套用快速紀錄：沿用評估 ${concerns.length} 項 · 標準流程 ${operations.length} 項 · 產品 ${products.length} 項 · 追蹤 ${followUp.tags.length} 項`,
    );
  }

  function handleComplete() {
    if (draft.clientFeeling === "不舒服" && !draft.discomfortNote.trim()) {
      setCompleteError("請記錄客人不舒服的部位或情況後再完成服務。");
      return;
    }
    setCompleteError("");

    const mergedPhotos = [...draft.photos];
    const seen = new Set(mergedPhotos.map((photo) => photo.id));
    photos.forEach((photo) => {
      if (seen.has(photo.id)) return;
      mergedPhotos.push({
        id: photo.id,
        treatmentId: photo.treatmentId,
        type: photo.type,
        createdAt: photo.createdAt,
        hadPreview: true,
      });
    });

    saveCompletedTreatment({
      ...draft,
      status: "completed",
      currentStep: "complete",
      photos: mergedPhotos,
    });
    setAppointmentStatus(appointment.id, "completed", appointment.organizationId);
    setFinished(true);
    setBlocked(false);
  }

  let stepContent = null;

  if (!hydrated) {
    stepContent = (
      <div className="flex min-h-[40vh] items-center justify-center text-secondary-text">
        載入療程草稿…
      </div>
    );
  } else if (finished) {
    stepContent = (
      <CompleteStep
        customer={customer}
        appointment={appointment}
        draft={draft}
        photos={photos}
        template={template}
        completed
        validationError=""
        onBack={goBack}
        onComplete={handleComplete}
      />
    );
  } else {
    switch (draft.currentStep) {
      case "summary":
        stepContent = (
          <CustomerSummaryStep
            customer={customer}
            appointment={appointment}
            templateName={template.name}
            onNext={goNext}
            onQuickRecord={applyQuickRecord}
          />
        );
        break;
      case "assessment":
        stepContent = (
          <AssessmentStep
            template={template}
            value={draft.assessment}
            previousHints={previousHints}
            onChange={(assessment) => updateDraft((prev) => ({ ...prev, assessment }))}
            onBack={goBack}
            onNext={goNext}
          />
        );
        break;
      case "bodyMap":
        stepContent = (
          <BodyMapStep
            template={template}
            markers={draft.bodyMarkers}
            bodyMapNote={draft.bodyMapNote}
            suggestedTrackingAreas={draft.suggestedTrackingAreas}
            onMarkersChange={(bodyMarkers) =>
              updateDraft((prev) => ({ ...prev, bodyMarkers }))
            }
            onNoteChange={(bodyMapNote) =>
              updateDraft((prev) => ({ ...prev, bodyMapNote }))
            }
            onBack={goBack}
            onNext={goNext}
            onSkip={() => skipStep("bodyMap")}
          />
        );
        break;
      case "operations":
        stepContent = (
          <OperationsStep
            template={template}
            operations={draft.operations}
            products={draft.products}
            onOperationsChange={(operations) =>
              updateDraft((prev) => ({ ...prev, operations }))
            }
            onProductsChange={(products) =>
              updateDraft((prev) => ({ ...prev, products }))
            }
            onBack={goBack}
            onNext={goNext}
          />
        );
        break;
      case "photos":
        stepContent = (
          <PhotosStep
            template={template}
            treatmentId={draft.id}
            photoMetas={draft.photos}
            photos={photos}
            onMetasChange={(next) => updateDraft((prev) => ({ ...prev, photos: next }))}
            onPhotosChange={setPhotos}
            onBack={goBack}
            onNext={goNext}
            onSkip={() => skipStep("photos")}
          />
        );
        break;
      case "professionalNote":
        stepContent = (
          <ProfessionalNoteStep
            template={template}
            isQuickMode={draft.mode === "QUICK"}
            professionalNote={draft.professionalNote}
            selectedQuickPhrases={draft.selectedQuickPhrases}
            noteManuallyEdited={draft.noteManuallyEdited}
            clientFeeling={draft.clientFeeling}
            discomfortNote={draft.discomfortNote}
            onUpdate={(patch) => updateDraft((prev) => ({ ...prev, ...patch }))}
            onBack={goBack}
            onNext={goNext}
            onJumpToComplete={() => goTo("complete")}
          />
        );
        break;
      case "followUp":
        stepContent = (
          <FollowUpStep
            template={template}
            draft={draft}
            value={draft.followUp}
            onChange={(followUp) => updateDraft((prev) => ({ ...prev, followUp }))}
            onBack={goBack}
            onNext={goNext}
            onSkip={() => skipStep("followUp")}
          />
        );
        break;
      case "complete":
        stepContent = (
          <CompleteStep
            customer={customer}
            appointment={appointment}
            draft={draft}
            photos={photos}
            template={template}
            completed={false}
            validationError={completeError}
            onBack={goBack}
            onComplete={handleComplete}
          />
        );
        break;
      default:
        stepContent = null;
    }
  }

  return (
    <div className="min-w-0">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <button
          type="button"
          className="min-h-11 text-sm text-secondary-text hover:text-primary"
          onClick={() => {
            if (hasContent && !finished) {
              setLeaveOpen(true);
              return;
            }
            router.push("/staff/today");
          }}
        >
          ← 返回今日工作台
        </button>
        <div className="flex flex-wrap items-center gap-3">
          {template.isGeneric ? (
            <span className="rounded-full bg-[#F3EEEC] px-2.5 py-1 text-xs text-secondary-text">
              目前使用通用療程模板
            </span>
          ) : null}
          {!finished ? <AutoSaveIndicator savedAt={savedAt} /> : null}
        </div>
      </div>

      {quickBanner && !finished ? (
        <div className="mb-4 rounded-2xl bg-primary-light/50 px-4 py-3 text-sm text-text">
          {quickBanner}
        </div>
      ) : null}

      {!finished ? (
        <div className="mb-5 min-[1024px]:hidden">
          <button
            type="button"
            className="w-full text-left"
            onClick={() => setMobileMenuOpen((open) => !open)}
            aria-expanded={mobileMenuOpen}
          >
            <TreatmentProgress
              currentIndex={currentIdx}
              total={TREATMENT_STEPS.length}
              label={currentMeta.label}
            />
            <p className="mt-1 text-xs text-secondary-text">點擊切換步驟</p>
          </button>
          {mobileMenuOpen ? (
            <div className="mt-3 grid grid-cols-2 gap-2">
              {TREATMENT_STEPS.map((step) => (
                <button
                  key={step.id}
                  type="button"
                  onClick={() => goTo(step.id)}
                  className={cn(
                    "min-h-11 rounded-2xl border px-3 text-left text-sm",
                    step.id === draft.currentStep
                      ? "border-primary bg-primary-light text-primary"
                      : "border-border text-text",
                  )}
                >
                  {step.label}
                  {isOptionalStep(step.id) ? (
                    <span className="ml-1 text-[10px] text-secondary-text">選填</span>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      <div
        className={
          finished
            ? "mx-auto w-full max-w-[1100px]"
            : "min-[1024px]:grid min-[1024px]:grid-cols-[260px_minmax(0,1fr)] min-[1024px]:items-start min-[1024px]:gap-6"
        }
      >
        {!finished ? (
          <div className="hidden min-[1024px]:block">
            <div className="sticky top-6">
              <TreatmentNavigation
                customer={customer}
                appointment={appointment}
                draft={draft}
                currentStep={draft.currentStep}
                onSelect={goTo}
              />
            </div>
          </div>
        ) : null}

        <div
          className={
            finished
              ? "min-w-0"
              : "min-w-0 rounded-2xl border border-border bg-surface p-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:p-6"
          }
        >
          {stepContent}
        </div>
      </div>

      <ConfirmDialog
        open={leaveOpen}
        title="本次療程紀錄尚未完成"
        description="資料已自動儲存，你可以稍後回來繼續填寫。"
        cancelLabel="繼續填寫"
        confirmLabel="離開"
        onCancel={() => setLeaveOpen(false)}
        onConfirm={() => {
          setLeaveOpen(false);
          setBlocked(false);
          router.push("/staff/today");
        }}
      />
    </div>
  );
}
