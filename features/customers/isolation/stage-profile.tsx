"use client";

import { CustomerProfilePage } from "@/features/customers/CustomerProfilePage";
import { ISOLATION_CUSTOMER_APP_ID } from "./live-appointment-fixture";

function ProfileLayer({
  stage,
  isolationLayer,
  isolationTab,
}: {
  stage: string;
  isolationLayer: "workspace" | "tabs" | "full";
  isolationTab?: "appointments";
}) {
  return (
    <div data-isolation-stage={stage}>
      <CustomerProfilePage
        customerId={ISOLATION_CUSTOMER_APP_ID}
        remoteReadPilot
        appointmentRemoteReadPilot
        isolationLayer={isolationLayer}
        isolationTab={isolationTab}
      />
    </div>
  );
}

export function StageBProfileShell() {
  return (
    <div data-isolation-stage="B">
      <CustomerProfilePage
        customerId={ISOLATION_CUSTOMER_APP_ID}
        remoteReadPilot
        appointmentRemoteReadPilot
        isolationLayer="shell"
      />
    </div>
  );
}

export function StageCWorkspace() {
  return <ProfileLayer stage="C" isolationLayer="workspace" />;
}

export function StageDTabs() {
  return <ProfileLayer stage="D" isolationLayer="tabs" />;
}

export function StageIFullAppointments() {
  return <ProfileLayer stage="I" isolationLayer="full" isolationTab="appointments" />;
}
