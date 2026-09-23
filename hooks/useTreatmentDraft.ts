"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import type { TreatmentDraft, TreatmentPhoto, TreatmentStepId } from "@/types/treatment";
import {
  createEmptyDraft,
  draftHasContent,
  loadDraft,
  saveDraft,
} from "@/lib/treatment-draft";

interface UseTreatmentDraftArgs {
  organizationId: string;
  locationId?: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
}

interface UseTreatmentDraftResult {
  draft: TreatmentDraft;
  photos: TreatmentPhoto[];
  setPhotos: Dispatch<SetStateAction<TreatmentPhoto[]>>;
  updateDraft: (updater: (prev: TreatmentDraft) => TreatmentDraft) => void;
  setStep: (step: TreatmentStepId) => void;
  savedAt: Date | null;
  isDirty: boolean;
  hasContent: boolean;
  hydrated: boolean;
}

export function useTreatmentDraft({
  organizationId,
  locationId,
  appointmentId,
  customerId,
  staffId,
  serviceId,
}: UseTreatmentDraftArgs): UseTreatmentDraftResult {
  const [draft, setDraft] = useState<TreatmentDraft>(() =>
    createEmptyDraft({
      organizationId,
      locationId,
      appointmentId,
      customerId,
      staffId,
      serviceId,
    }),
  );
  const [photos, setPhotos] = useState<TreatmentPhoto[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const skipNextSave = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      const existing = loadDraft(organizationId, appointmentId);
      const next =
        existing ??
        createEmptyDraft({
          organizationId,
          locationId,
          appointmentId,
          customerId,
          staffId,
          serviceId,
        });
      setDraft(next);
      setPhotos([]);
      setHydrated(true);
      skipNextSave.current = true;
      if (existing) setSavedAt(new Date(existing.updatedAt));
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [organizationId, locationId, appointmentId, customerId, staffId, serviceId]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    const timer = window.setTimeout(() => {
      saveDraft(draft);
      setSavedAt(new Date());
    }, 280);
    return () => window.clearTimeout(timer);
  }, [draft, hydrated]);

  const updateDraft = useCallback((updater: (prev: TreatmentDraft) => TreatmentDraft) => {
    setDraft((prev) => updater(prev));
  }, []);

  const setStep = useCallback((step: TreatmentStepId) => {
    setDraft((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const hasContent = useMemo(
    () => draftHasContent(draft) || photos.length > 0,
    [draft, photos],
  );

  return {
    draft,
    photos,
    setPhotos,
    updateDraft,
    setStep,
    savedAt,
    isDirty: hasContent && draft.status === "draft",
    hasContent,
    hydrated,
  };
}
