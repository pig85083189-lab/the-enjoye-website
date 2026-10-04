"use client";

import { useSyncExternalStore } from "react";
import {
  getTreatmentRemoteWriteRevision,
  subscribeTreatmentRemoteWriteRefresh,
} from "./treatment-write-refresh";

export function useTreatmentRemoteWriteRevision(): number {
  return useSyncExternalStore(
    subscribeTreatmentRemoteWriteRefresh,
    getTreatmentRemoteWriteRevision,
    () => 0,
  );
}
