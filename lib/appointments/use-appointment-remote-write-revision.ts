"use client";

import { useSyncExternalStore } from "react";
import {
  getAppointmentRemoteWriteRevision,
  subscribeAppointmentRemoteWriteRefresh,
} from "./appointment-write-refresh";

export function useAppointmentRemoteWriteRevision(): number {
  return useSyncExternalStore(
    subscribeAppointmentRemoteWriteRefresh,
    getAppointmentRemoteWriteRevision,
    () => 0,
  );
}
