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
import type { CanonicalAppointmentStatus } from "@/lib/appointments/domain";
import {
  submitTreatmentRemoteAutosave,
  submitTreatmentRemoteComplete,
  submitTreatmentRemoteCreate,
} from "@/features/treatments/use-treatment-remote-write";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { IdentitySupabaseClient } from "@/lib/persistence/authenticated-identity-catalog";
import { getRemotePilotTreatmentByAppointment } from "@/lib/treatments/treatment-remote-read-pilot";
import { TreatmentDuplicateError } from "@/lib/treatments/treatment-write-errors";
import { shouldCreateTreatmentForAppointment } from "@/lib/treatments/treatment-today";
import {
  createEmptyDraft,
  draftHasContent,
  loadDraft,
  saveCompletedTreatment,
  saveDraft,
} from "@/lib/treatment-draft";
import type { TreatmentDraft, TreatmentPhoto, TreatmentStepId } from "@/types/treatment";

interface UseTreatmentDraftArgs {
  organizationId: string;
  locationId?: string;
  appointmentId: string;
  customerId: string;
  staffId: string;
  serviceId: string;
  remoteReadPilot?: boolean;
  remoteWritePilot?: boolean;
  appointmentStatus?: CanonicalAppointmentStatus;
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
  saving: boolean;
  saveError: string | null;
  recordSource: "local" | "remote";
  completeTreatment: (next: TreatmentDraft) => Promise<TreatmentDraft>;
}

function emptyDraft(input: UseTreatmentDraftArgs): TreatmentDraft {
  return createEmptyDraft({
    organizationId: input.organizationId,
    locationId: input.locationId,
    appointmentId: input.appointmentId,
    customerId: input.customerId,
    staffId: input.staffId,
    serviceId: input.serviceId,
  });
}

function photoMetaOnly(draft: TreatmentDraft): TreatmentDraft {
  return {
    ...draft,
    photos: (draft.photos ?? []).map((photo) => ({
      id: photo.id,
      treatmentId: photo.treatmentId,
      type: photo.type,
      createdAt: photo.createdAt,
      hadPreview: Boolean(photo.hadPreview),
    })),
  };
}

export function useTreatmentDraft(args: UseTreatmentDraftArgs): UseTreatmentDraftResult {
  const remoteRead = Boolean(args.remoteReadPilot);
  const remoteWrite = Boolean(args.remoteWritePilot && args.remoteReadPilot);
  const [draft, setDraft] = useState<TreatmentDraft>(() => emptyDraft(args));
  const [photos, setPhotos] = useState<TreatmentPhoto[]>([]);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const skipNextSave = useRef(true);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        if (cancelled) return;
        if (!remoteRead) {
          const existing = loadDraft(args.organizationId, args.appointmentId);
          const next =
            existing ??
            createEmptyDraft({
              organizationId: args.organizationId,
              locationId: args.locationId,
              appointmentId: args.appointmentId,
              customerId: args.customerId,
              staffId: args.staffId,
              serviceId: args.serviceId,
            });
          setDraft(next);
          setPhotos([]);
          setHydrated(true);
          skipNextSave.current = true;
          if (existing) setSavedAt(new Date(existing.updatedAt));
          return;
        }

        try {
          const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
          if (!client) {
            throw new Error("Authenticated Supabase client is unavailable");
          }
          let existing = await getRemotePilotTreatmentByAppointment(
            args.organizationId,
            args.appointmentId,
            client,
          );
          if (
            !existing &&
            remoteWrite &&
            shouldCreateTreatmentForAppointment(args.appointmentStatus)
          ) {
            try {
              existing = await submitTreatmentRemoteCreate({
                locationId: args.locationId ?? "",
                customerId: args.customerId,
                serviceId: args.serviceId,
                staffId: args.staffId,
                appointmentId: args.appointmentId,
              });
            } catch (error: unknown) {
              if (!(error instanceof TreatmentDuplicateError)) throw error;
              existing = await getRemotePilotTreatmentByAppointment(
                args.organizationId,
                args.appointmentId,
                client,
              );
            }
          }
          if (cancelled) return;
          const next =
            existing ??
            createEmptyDraft({
              organizationId: args.organizationId,
              locationId: args.locationId,
              appointmentId: args.appointmentId,
              customerId: args.customerId,
              staffId: args.staffId,
              serviceId: args.serviceId,
            });
          setDraft(next);
          setPhotos([]);
          setHydrated(true);
          skipNextSave.current = true;
          setSaveError(null);
          if (existing) setSavedAt(new Date(existing.updatedAt));
        } catch (error: unknown) {
          if (cancelled) return;
          setHydrated(true);
          skipNextSave.current = true;
          setSaveError(
            error instanceof Error ? error.message : "Remote treatment read failed",
          );
        }
      })();
    }, 0);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [
    args.appointmentId,
    args.appointmentStatus,
    args.customerId,
    args.locationId,
    args.organizationId,
    args.serviceId,
    args.staffId,
    remoteRead,
    remoteWrite,
  ]);

  useEffect(() => {
    if (!hydrated) return;
    if (skipNextSave.current) {
      skipNextSave.current = false;
      return;
    }
    if (remoteRead && !remoteWrite) {
      return;
    }
    if (!remoteRead) {
      const timer = window.setTimeout(() => {
        saveDraft(draft);
        setSavedAt(new Date());
      }, 280);
      return () => window.clearTimeout(timer);
    }

    if (draft.status !== "draft") return;
    if (!draft.id.startsWith("trt-")) return;
    const expectedUpdatedAt = draft.updatedAt;
    if (!expectedUpdatedAt) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        setSaving(true);
        try {
          const saved = await submitTreatmentRemoteAutosave({
            treatmentId: draft.id,
            expectedUpdatedAt,
            locationId: draft.locationId ?? args.locationId ?? "",
            customerId: draft.customerId,
            serviceId: draft.serviceId,
            staffId: draft.staffId,
            appointmentId: draft.appointmentId,
            draft: photoMetaOnly(draft),
          });
          skipNextSave.current = true;
          setDraft(saved);
          setSavedAt(new Date(saved.updatedAt));
          setSaveError(null);
        } catch (error: unknown) {
          setSaveError(error instanceof Error ? error.message : "Remote autosave failed");
        } finally {
          setSaving(false);
        }
      })();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [args.locationId, draft, hydrated, remoteRead, remoteWrite]);

  const updateDraft = useCallback((updater: (prev: TreatmentDraft) => TreatmentDraft) => {
    setDraft((prev) => updater(prev));
  }, []);

  const setStep = useCallback((step: TreatmentStepId) => {
    setDraft((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const completeTreatment = useCallback(
    async (next: TreatmentDraft): Promise<TreatmentDraft> => {
      if (!remoteWrite) {
        saveCompletedTreatment(next);
        skipNextSave.current = true;
        setDraft(next);
        return next;
      }
      if (next.status === "completed" && draftRef.current.status === "completed") {
        return draftRef.current;
      }
      const completed = await submitTreatmentRemoteComplete({
        treatmentId: next.id,
        expectedUpdatedAt: next.updatedAt,
        locationId: next.locationId ?? args.locationId ?? "",
        customerId: next.customerId,
        serviceId: next.serviceId,
        staffId: next.staffId,
        appointmentId: next.appointmentId,
        draft: photoMetaOnly(next),
      });
      skipNextSave.current = true;
      setDraft(completed);
      setSavedAt(new Date(completed.updatedAt));
      setSaveError(null);
      return completed;
    },
    [args.locationId, remoteWrite],
  );

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
    saving,
    saveError,
    recordSource: remoteRead ? "remote" : "local",
    completeTreatment,
  };
}
