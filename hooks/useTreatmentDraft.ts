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
import { TREATMENT_REMOTE_READ_PILOT_ENV } from "@/lib/treatments/treatment-remote-read-flag";
import { getRemotePilotTreatmentByAppointment } from "@/lib/treatments/treatment-remote-read-pilot";
import { TreatmentDuplicateError } from "@/lib/treatments/treatment-write-errors";
import { completedTreatmentClinicalFieldsMatch } from "@/lib/treatments/completed-treatment-migration-preflight";
import {
  browserClinicalFieldsMatch,
  decideBrowserCompletedHydration,
  syncBrowserCompletedTreatment,
} from "@/lib/treatments/sync-browser-completed-treatment";

function treatmentReadPilotEnv(): NodeJS.Dict<string> {
  return {
    ...process.env,
    [TREATMENT_REMOTE_READ_PILOT_ENV]: "1",
  };
}
import { shouldCreateTreatmentForAppointment } from "@/lib/treatments/treatment-today";
import {
  createEmptyDraft,
  draftHasContent,
  loadDraft,
  listStoredCompletedTreatments,
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
  const [autosaveRetryRevision, setAutosaveRetryRevision] = useState(0);
  const skipNextSave = useRef(true);
  const remoteRecordReady = useRef(false);
  const remoteVerified = useRef(false);
  const pendingBrowserSync = useRef(false);
  const autosaveInFlight = useRef(false);
  const locallyCompleted = useRef(false);
  const editRevision = useRef(0);
  const draftRef = useRef(draft);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);

  useEffect(() => {
    let cancelled = false;
    // Completion is scoped to one appointment, not the lifetime of the hook.
    locallyCompleted.current = false;
    remoteVerified.current = false;
    pendingBrowserSync.current = false;
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

        remoteRecordReady.current = false;
        try {
          const client = createBrowserClientOrNull() as IdentitySupabaseClient | null;
          if (!client) {
            throw new Error("Authenticated Supabase client is unavailable");
          }
          let existing = await getRemotePilotTreatmentByAppointment(
            args.organizationId,
            args.appointmentId,
            client,
            treatmentReadPilotEnv(),
          );
          // Only block creating an empty remote record if a meaningful
          // browser-only draft exists. An already persisted remote treatment
          // must remain accessible even when an old local draft is present.
          const legacyDraft = loadDraft(args.organizationId, args.appointmentId);
          if (!existing && legacyDraft && draftHasContent(legacyDraft)) {
            throw new Error(
              "偵測到尚未同步的本機療程草稿，已保留原始資料並暫停建立空白遠端紀錄。請先確認資料轉移。",
            );
          }
          // Never create a blank remote draft over a completed browser-only
          // treatment. Its clinical contents require an explicit, verified
          // migration, even when the old draft key has already been cleared.
          const legacyCompleted = listStoredCompletedTreatments(args.organizationId).filter(
            (record) => record.appointmentId === args.appointmentId,
          );
          const hydration = decideBrowserCompletedHydration({
            remoteWrite,
            localRecords: legacyCompleted,
            remote: existing ?? null,
            identity: {
              organizationId: args.organizationId,
              locationId: args.locationId,
              appointmentId: args.appointmentId,
              customerId: args.customerId,
              staffId: args.staffId,
              serviceId: args.serviceId,
            },
          });
          if (hydration.action === "stop") {
            throw new Error(hydration.message);
          }
          if (hydration.action === "sync") {
            if (cancelled) return;
            // Keep the browser copy. The therapist confirms it with the
            // existing complete action; opening the screen does not write.
            pendingBrowserSync.current = true;
            remoteRecordReady.current = false;
            remoteVerified.current = false;
            setDraft(hydration.local);
            setPhotos([]);
            setHydrated(true);
            skipNextSave.current = true;
            setSaveError(null);
            setSavedAt(new Date(hydration.local.updatedAt));
            return;
          }
          if (
            !existing &&
            remoteWrite &&
            shouldCreateTreatmentForAppointment(args.appointmentStatus)
          ) {
            try {
              existing = await submitTreatmentRemoteCreate({
                organizationId: args.organizationId,
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
                treatmentReadPilotEnv(),
              );
            }
          }
          if (cancelled) return;
          remoteRecordReady.current = Boolean(existing);
          remoteVerified.current = existing?.status === "completed";
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
        // Completion clears the draft. A delayed autosave must not recreate it.
        if (locallyCompleted.current || draft.status === "completed") return;
        try {
          saveDraft(draft);
          setSavedAt(new Date());
          setSaveError(null);
        } catch (error: unknown) {
          setSaveError(error instanceof Error ? error.message : "療程草稿儲存失敗");
        }
      }, 280);
      return () => window.clearTimeout(timer);
    }

    if (draft.status !== "draft") return;
    if (!draft.id.startsWith("trt-")) return;
    const expectedUpdatedAt = draft.updatedAt;
    if (!expectedUpdatedAt) return;

    const timer = window.setTimeout(() => {
      void (async () => {
        if (autosaveInFlight.current) {
          // The pending request will schedule a retry when it settles.
          return;
        }
        autosaveInFlight.current = true;
        const submittedRevision = editRevision.current;
        setSaving(true);
        try {
          const saved = await submitTreatmentRemoteAutosave({
                organizationId: args.organizationId,
            treatmentId: draft.id,
            expectedUpdatedAt,
            locationId: draft.locationId ?? args.locationId ?? "",
            customerId: draft.customerId,
            serviceId: draft.serviceId,
            staffId: draft.staffId,
            appointmentId: draft.appointmentId,
            draft: photoMetaOnly(draft),
          });
          if (editRevision.current === submittedRevision) {
            skipNextSave.current = true;
            setDraft(saved);
          } else {
            // Preserve edits made while the request was in flight. Rebase the
            // concurrency token so the next autosave persists those edits.
            setDraft((current) => ({ ...current, updatedAt: saved.updatedAt }));
          }
          setSavedAt(new Date(saved.updatedAt));
          setSaveError(null);
        } catch (error: unknown) {
          setSaveError(error instanceof Error ? error.message : "Remote autosave failed");
        } finally {
          autosaveInFlight.current = false;
          setSaving(false);
          // A newer draft may have been skipped while this request ran.
          // Re-evaluate autosave with the latest draft and concurrency token.
          if (editRevision.current !== submittedRevision) {
            setAutosaveRetryRevision((revision) => revision + 1);
          }
        }
      })();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [args.locationId, draft, hydrated, remoteRead, remoteWrite, autosaveRetryRevision]);

  const updateDraft = useCallback((updater: (prev: TreatmentDraft) => TreatmentDraft) => {
    editRevision.current += 1;
    setDraft((prev) => updater(prev));
  }, []);

  const setStep = useCallback((step: TreatmentStepId) => {
    editRevision.current += 1;
    setDraft((prev) => ({ ...prev, currentStep: step }));
  }, []);

  const completeTreatment = useCallback(
    async (next: TreatmentDraft): Promise<TreatmentDraft> => {
      // A remote-read-only session must never claim a locally completed
      // treatment: the member portal only reads authoritative remote rows.
      if (remoteRead && !remoteWrite) {
        throw new Error("療程尚未啟用正式資料庫寫入，無法完成同步。請聯絡管理員確認設定。");
      }
      if (!remoteWrite) {
        // The customer history screen reads the completed-record collection,
        // not the active treatment draft. Verify the exact appointment and
        // customer there before reporting success or changing appointment status.
        if (next.appointmentId !== args.appointmentId ||
            next.customerId !== args.customerId ||
            next.organizationId !== args.organizationId) {
          throw new Error("療程身分與目前預約不一致，已停止完成並保留草稿。");
        }
        saveCompletedTreatment(next);
        const persisted = listStoredCompletedTreatments(args.organizationId).find(
          (item) => item.id === next.id &&
            item.appointmentId === args.appointmentId &&
            item.customerId === args.customerId &&
            item.status === "completed" &&
            item.organizationId === args.organizationId &&
            item.locationId === next.locationId &&
            item.staffId === next.staffId &&
            item.serviceId === next.serviceId &&
            completedTreatmentClinicalFieldsMatch({ ...next, status: "completed" }, item),
        );
        if (!persisted) {
          throw new Error("客戶療程列表尚未讀取到已完成紀錄，已停止更新預約狀態。");
        }
        locallyCompleted.current = true;
        skipNextSave.current = true;
        setDraft(persisted);
        return persisted;
      }
      if (!remoteRecordReady.current && !pendingBrowserSync.current) {
        throw new Error("正式資料庫尚未建立療程草稿，無法完成療程。請重新進入療程後再試。");
      }
      if (saveError) {
        throw new Error(`療程尚有未解決的儲存錯誤：${saveError}`);
      }
      if (autosaveInFlight.current || saving) {
        throw new Error("療程正在自動儲存，請等待儲存完成後再按完成療程。");
      }
      // A completion must use the latest edited draft, not an older render
      // captured while the user was still filling in clinical fields.
      if (editRevision.current > 0 &&
          JSON.stringify(photoMetaOnly(next)) !== JSON.stringify(photoMetaOnly({
            ...draftRef.current,
            status: "completed",
            currentStep: "complete",
            photos: next.photos,
          }))) {
        throw new Error("療程內容剛更新，請確認最新內容後再次按完成療程。");
      }
      if (
        remoteVerified.current &&
        next.status === "completed" &&
        draftRef.current.status === "completed"
      ) {
        return draftRef.current;
      }
      if (pendingBrowserSync.current) {
        const identity = {
          organizationId: args.organizationId,
          locationId: args.locationId,
          appointmentId: args.appointmentId,
          customerId: args.customerId,
          staffId: args.staffId,
          serviceId: args.serviceId,
        };
        const synced = await syncBrowserCompletedTreatment({
          identity,
          local: next,
          readRemote: async () => {
            const verifyClient = createBrowserClientOrNull() as IdentitySupabaseClient | null;
            if (!verifyClient) throw new Error("無法驗證正式療程資料，請保留原始紀錄。");
            return (
              (await getRemotePilotTreatmentByAppointment(
                args.organizationId,
                args.appointmentId,
                verifyClient,
                treatmentReadPilotEnv(),
              )) ?? null
            );
          },
          createRemote: (source) =>
            submitTreatmentRemoteCreate({
              organizationId: args.organizationId,
              locationId: source.locationId ?? args.locationId ?? "",
              customerId: source.customerId,
              serviceId: source.serviceId,
              staffId: source.staffId,
              appointmentId: source.appointmentId,
              draft: photoMetaOnly(source),
            }),
          completeRemote: (remote, source) =>
            submitTreatmentRemoteComplete({
              organizationId: args.organizationId,
              treatmentId: remote.id,
              expectedUpdatedAt: remote.updatedAt,
              locationId: remote.locationId ?? args.locationId ?? "",
              customerId: remote.customerId,
              serviceId: remote.serviceId,
              staffId: remote.staffId,
              appointmentId: remote.appointmentId,
              draft: photoMetaOnly({ ...source, id: remote.id }),
              completedAtFromAppointment: true,
            }),
        });
        const verifyClient = createBrowserClientOrNull() as IdentitySupabaseClient | null;
        if (!verifyClient) throw new Error("無法驗證正式療程資料，請保留原始紀錄。");
        const verified = await getRemotePilotTreatmentByAppointment(
          args.organizationId,
          args.appointmentId,
          verifyClient,
          treatmentReadPilotEnv(),
        );
        if (
          !verified ||
          verified.id !== synced.id ||
          verified.organizationId !== args.organizationId ||
          verified.appointmentId !== args.appointmentId ||
          verified.customerId !== args.customerId ||
          verified.status !== "completed" ||
          !browserClinicalFieldsMatch(photoMetaOnly(next), verified)
        ) {
          throw new Error("療程已送出但正式資料庫回讀驗證失敗，請勿重複建立療程。");
        }
        pendingBrowserSync.current = false;
        remoteRecordReady.current = true;
        remoteVerified.current = true;
        skipNextSave.current = true;
        setDraft(verified);
        setSavedAt(new Date(verified.updatedAt));
        setSaveError(null);
        return verified;
      }
      if (!remoteRecordReady.current) {
        throw new Error("正式資料庫尚未建立療程草稿，無法完成療程。請重新進入療程後再試。");
      }
      const completed = await submitTreatmentRemoteComplete({
                organizationId: args.organizationId,
        treatmentId: next.id,
        expectedUpdatedAt: next.updatedAt,
        locationId: next.locationId ?? args.locationId ?? "",
        customerId: next.customerId,
        serviceId: next.serviceId,
        staffId: next.staffId,
        appointmentId: next.appointmentId,
        draft: photoMetaOnly(next),
      });
      // Re-read the authoritative row before reporting completion. A successful
      // mutation response alone is not proof that the member-facing store can read it.
      const verifyClient = createBrowserClientOrNull() as IdentitySupabaseClient | null;
      if (!verifyClient) throw new Error("無法驗證正式療程資料，請保留原始紀錄。");
      const verified = await getRemotePilotTreatmentByAppointment(
        args.organizationId, args.appointmentId, verifyClient, treatmentReadPilotEnv(),
      );
      if (!verified || verified.id !== completed.id ||
          verified.organizationId !== args.organizationId ||
          verified.appointmentId !== args.appointmentId ||
          verified.customerId !== args.customerId ||
          !completedTreatmentClinicalFieldsMatch(photoMetaOnly(next), verified)) {
        throw new Error("療程已送出但正式資料庫回讀驗證失敗，請勿重複建立療程。");
      }
      remoteVerified.current = true;
      skipNextSave.current = true;
      setDraft(verified);
      setSavedAt(new Date(verified.updatedAt));
      setSaveError(null);
      return verified;
    },
    [args.appointmentId, args.customerId, args.organizationId, args.locationId, remoteWrite, remoteRead, saveError, saving],
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
