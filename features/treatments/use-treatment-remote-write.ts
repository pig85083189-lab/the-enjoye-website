"use client";

import {
  runAuthenticatedTreatmentAutosave,
  runAuthenticatedTreatmentComplete,
  runAuthenticatedTreatmentCreate,
  type TreatmentWriteClient,
} from "@/lib/treatments/treatment-remote-write-pilot";
import { emitTreatmentRemoteWriteRefresh } from "@/lib/treatments/treatment-write-refresh";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import type { TreatmentDraft } from "@/types/treatment";

function writeClient(): TreatmentWriteClient | null {
  return createBrowserClientOrNull() as TreatmentWriteClient | null;
}

function requireClient(): TreatmentWriteClient {
  const client = writeClient();
  if (!client) {
    throw new Error("Authenticated Supabase client is unavailable");
  }
  return client;
}

export async function submitTreatmentRemoteCreate(input: {
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  appointmentId?: string;
  id?: string;
  draft?: Partial<TreatmentDraft>;
  templateType?: string;
}): Promise<TreatmentDraft> {
  const created = await runAuthenticatedTreatmentCreate(requireClient(), input);
  emitTreatmentRemoteWriteRefresh({
    organizationId: created.organizationId,
    customerId: created.customerId,
    appointmentId: created.appointmentId,
    treatmentId: created.id,
  });
  return created;
}

export async function submitTreatmentRemoteAutosave(input: {
  treatmentId: string;
  expectedUpdatedAt: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  appointmentId?: string;
  draft: TreatmentDraft;
}): Promise<TreatmentDraft> {
  const saved = await runAuthenticatedTreatmentAutosave(requireClient(), input);
  emitTreatmentRemoteWriteRefresh({
    organizationId: saved.organizationId,
    customerId: saved.customerId,
    appointmentId: saved.appointmentId,
    treatmentId: saved.id,
  });
  return saved;
}

export async function submitTreatmentRemoteComplete(input: {
  treatmentId: string;
  expectedUpdatedAt: string;
  locationId: string;
  customerId: string;
  serviceId: string;
  staffId: string;
  appointmentId?: string;
  draft: TreatmentDraft;
}): Promise<TreatmentDraft> {
  const completed = await runAuthenticatedTreatmentComplete(requireClient(), input);
  emitTreatmentRemoteWriteRefresh({
    organizationId: completed.organizationId,
    customerId: completed.customerId,
    appointmentId: completed.appointmentId,
    treatmentId: completed.id,
  });
  return completed;
}
