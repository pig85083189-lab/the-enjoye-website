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
import { ConsultationFields } from "@/features/treatments/steps/ConsultationFields";
import { DEFAULT_CONSULTATION_FIELDS, type ConsultationField } from "@/lib/consultation-settings";
import { BodyMapStep } from "@/features/treatments/steps/BodyMapStep";
import { CompleteStep } from "@/features/treatments/steps/CompleteStep";
import { CustomerSummaryStep } from "@/features/treatments/steps/CustomerSummaryStep";
import { FollowUpStep } from "@/features/treatments/steps/FollowUpStep";
import { PhotosStep } from "@/features/treatments/steps/PhotosStep";
import { useTreatmentDraft } from "@/hooks/useTreatmentDraft";
import { getTreatmentTemplateForService } from "@/data/treatment-templates";
import { resolveTreatmentTemplateLabel } from "@/lib/treatments/treatment-display";
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import { setAppointmentStatus } from "@/lib/appointment-store";
import {
  getPreviousTreatmentHints,
  mapFollowUpToSuggestedAreas,
} from "@/lib/treatment-hints";
import { stepIndex } from "@/lib/treatment-draft";
import type { Appointment, Customer } from "@/types";
import {
  TREATMENT_STEPS,
  CLIENT_FEELINGS,
  isOptionalStep,
  type TreatmentStepId,
} from "@/types/treatment";
import { cn } from "@/lib/utils";

interface TreatmentWorkspaceProps {
  customer: Customer;
  appointment: Appointment;
  canonicalStatus?: CanonicalAppointmentStatus;
  treatmentRemoteReadPilot?: boolean;
  treatmentRemoteWritePilot?: boolean;
  commerceRemoteReadPilot?: boolean;
}

const STEP_ORDER = TREATMENT_STEPS.map((step) => step.id);

export function TreatmentWorkspace({
  customer,
  appointment,
  canonicalStatus,
  treatmentRemoteReadPilot = false,
  treatmentRemoteWritePilot = false,
  commerceRemoteReadPilot = false,
}: TreatmentWorkspaceProps) {
  const router = useRouter();
  const { setBlocked } = useLeaveGuard();
  const [finished, setFinished] = useState(false);
  const [leaveOpen, setLeaveOpen] = useState(false);
  const [completeError, setCompleteError] = useState("");
  const [quickBanner, setQuickBanner] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const [consultationFields, setConsultationFields] = useState<ConsultationField[]>(DEFAULT_CONSULTATION_FIELDS);
  const [consultationLoading, setConsultationLoading] = useState(true);
  const [consultationError, setConsultationError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setConsultationLoading(true);
    setConsultationError("");
    fetch(`/api/staff/consultation-settings?organizationId=${encodeURIComponent(appointment.organizationId)}`, { cache: "no-store" })
      .then(async (response) => { const data = await response.json(); if (!response.ok) throw new Error(data.error ?? "讀取諮詢設定失敗"); return data; })
      .then((data) => { if (!cancelled) setConsultationFields(data.fields); })
      .catch((error) => { if (!cancelled) { setConsultationFields(DEFAULT_CONSULTATION_FIELDS); setConsultationError(`目前無法同步店家自訂設定，已暫時顯示預設欄位。${error instanceof Error ? `（${error.message}）` : ""}填寫內容會依目前療程儲存模式保存。`); } })
      .finally(() => { if (!cancelled) setConsultationLoading(false); });
    return () => { cancelled = true; };
  }, [appointment.organizationId]);

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
    saving,
    saveError,
    completeTreatment,
  } = useTreatmentDraft({
    organizationId: appointment.organizationId,
    locationId: appointment.locationId,
    appointmentId: appointment.id,
    customerId: customer.id,
    staffId: appointment.staffId,
    serviceId: appointment.serviceId,
    remoteReadPilot: treatmentRemoteReadPilot,
    remoteWritePilot: treatmentRemoteWritePilot,
    appointmentStatus: canonicalStatus,
  });

  const consultationValues = draft.assessment.consultationAnswers ?? {};
  const changeConsultation = (id: string, value: string | string[]) => updateDraft((prev) => ({ ...prev, assessment: { ...prev.assessment, consultationAnswers: { ...prev.assessment.consultationAnswers, [id]: value } } }));

  useEffect(() => {
    if (treatmentRemoteReadPilot) return;
    if (appointment.status !== "completed" && appointment.status !== "in_progress") {
      setAppointmentStatus(appointment.id, "in_progress", appointment.organizationId);
    }
  }, [
    appointment.id,
    appointment.organizationId,
    appointment.status,
    treatmentRemoteReadPilot,
  ]);

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
        consultationAnswers: prev.assessment.consultationAnswers ?? {},
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

  async function handleComplete() {
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

    const next = {
      ...draft,
      status: "completed" as const,
      currentStep: "complete" as const,
      photos: mergedPhotos,
    };

    try {
      await completeTreatment(next);
      if (!treatmentRemoteReadPilot) {
        setAppointmentStatus(appointment.id, "completed", appointment.organizationId);
      }
      setFinished(true);
      setBlocked(false);
    } catch (error: unknown) {
      setCompleteError(
        error instanceof Error ? error.message : "完成療程失敗，請稍後再試。",
      );
    }
  }

  let stepContent = null;

  if (!hydrated || ((draft.currentStep === "assessment" || draft.currentStep === "professionalNote") && consultationLoading)) {
    stepContent = (
      <div className="flex min-h-[40vh] items-center justify-center text-secondary-text">
        {"載入療程草稿及諮詢設定…"}
      </div>
    );
  } else if (finished) {
    stepContent = (
      <CompleteStep
        consultationFields={consultationFields}
        customer={customer}
        appointment={appointment}
        draft={draft}
        photos={photos}
        template={template}
        completed
        validationError=""
        commerceRemoteRead={commerceRemoteReadPilot}
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
          <div>
            <div className="mb-5 rounded-2xl border border-[#C9DDD1] bg-[#F2F8F3] p-4"><p className="text-xs font-semibold text-[#426A52]">01 會員可見紀錄</p><h1 className="mt-1 text-2xl font-semibold text-text">今日評估</h1><p className="mt-2 text-sm text-secondary-text">這裡填寫的自訂評估內容，會在完成療程後提供會員查看。</p></div>
            {consultationError ? <p role="alert" className="mb-4 rounded-xl border border-warning/30 bg-background p-3 text-sm text-secondary-text">{consultationError}</p> : null}
            <ConsultationFields fields={consultationFields.filter((field) => field.section === "assessment")} values={consultationValues} onChange={changeConsultation} />
            <div className="mt-5 flex justify-between gap-3"><button className="min-h-11 rounded-xl border border-border px-4" onClick={goBack}>上一步</button><button className="min-h-11 rounded-xl bg-primary px-4 text-white" onClick={goNext}>下一步：部位紀錄</button></div>
          </div>
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
        // Historical drafts may still point here; show the next visible step without erasing legacy data.
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
          <div>
            <div className="mb-5 rounded-2xl border border-[#C9DDD1] bg-[#F2F8F3] p-4"><p className="text-xs font-semibold text-[#426A52]">01 會員可見紀錄</p><h1 className="mt-1 text-2xl font-semibold text-text">專業紀錄與保養推薦</h1><p className="mt-2 text-sm text-secondary-text">這裡的自訂欄位會同步會員。請填寫適合顧客閱讀的內容，不要輸入內部交班資訊。</p></div>
            {consultationError ? <p role="alert" className="mb-4 rounded-xl border border-warning/30 bg-background p-3 text-sm text-secondary-text">{consultationError}</p> : null}
            <ConsultationFields fields={consultationFields.filter((field) => field.section === "professionalNote")} values={consultationValues} onChange={changeConsultation} />
            <div className="mt-5 space-y-4 rounded-2xl border border-[#C9DDD1] bg-white p-4">
              <label className="block text-sm font-semibold text-text" htmlFor="member-professional-note">美容師服務紀錄（會員可見）</label>
              <textarea id="member-professional-note" rows={4} className="w-full rounded-xl border border-border bg-background p-3 text-sm text-text" value={draft.professionalNote} onChange={event => updateDraft(prev => ({...prev, professionalNote:event.target.value, noteManuallyEdited:true}))} placeholder="記錄本次服務觀察與照護情況" />
              <label className="block text-sm font-semibold text-text" htmlFor="member-client-feeling">客人療程後感受（會員可見）</label>
              <select id="member-client-feeling" className="min-h-11 w-full rounded-xl border border-border bg-background px-3 text-sm text-text" value={draft.clientFeeling} onChange={event => updateDraft(prev => ({...prev, clientFeeling:event.target.value, discomfortNote:event.target.value==="不舒服"?prev.discomfortNote:""}))}>
                <option value="">尚未選擇</option>
                {CLIENT_FEELINGS.map(feeling=><option key={feeling} value={feeling}>{feeling}</option>)}
              </select>
              {draft.clientFeeling==="不舒服" ? <>
                <label className="block text-sm font-semibold text-text" htmlFor="member-discomfort-note">不適情況（會員可見）</label>
                <textarea id="member-discomfort-note" rows={3} className="w-full rounded-xl border border-border bg-background p-3 text-sm text-text" value={draft.discomfortNote} onChange={event => updateDraft(prev => ({...prev, discomfortNote:event.target.value}))} placeholder="請記錄不適部位與情況" />
              </> : null}
            </div>
            <div className="mt-5 flex justify-between gap-3"><button className="min-h-11 rounded-xl border border-border px-4" onClick={goBack}>上一步</button><button className="min-h-11 rounded-xl bg-primary px-4 text-white" onClick={goNext}>下一步：下次追蹤</button></div>
          </div>
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
            consultationFields={consultationFields}
            customer={customer}
            appointment={appointment}
            draft={draft}
            photos={photos}
            template={template}
            completed={false}
            validationError={completeError}
            commerceRemoteRead={commerceRemoteReadPilot}
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
          <span className="rounded-full bg-[#F3EEEC] px-2.5 py-1 text-xs text-secondary-text">
            {resolveTreatmentTemplateLabel({
              serviceId: appointment.serviceId,
              snapshotName: appointment.serviceName,
            })}
          </span>
          {!finished ? (
            <div className="space-y-1 text-right">
              <AutoSaveIndicator
                savedAt={savedAt}
                saving={saving}
                error={Boolean(saveError)}
              />
            </div>
          ) : null}
        </div>
      </div>

      {quickBanner && !finished ? (
        <div className="mb-4 rounded-2xl bg-primary-light/50 px-4 py-3 text-sm text-text">
          {quickBanner}
        </div>
      ) : null}

      {!finished ? (
        <div className="mb-5 rounded-2xl border border-[#E9D7D4] bg-white p-3 text-sm">
          <p className="font-semibold text-[#552F3D]">療程紀錄分類</p>
          <div className="mt-2 flex flex-wrap gap-2"><span className="rounded-full bg-[#EDF6EF] px-3 py-1.5 text-xs font-medium text-[#426A52]">會員可見：今日評估、部位紀錄、專業紀錄、保養建議</span><span className="rounded-full bg-[#F3EEEC] px-3 py-1.5 text-xs font-medium text-[#704351]">店內專用：照片、操作及內部資料</span></div>
          <p className="mt-2 text-xs text-secondary-text">依原有步驟填寫並自動儲存；完成前可在確認頁檢查資料。</p>
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
