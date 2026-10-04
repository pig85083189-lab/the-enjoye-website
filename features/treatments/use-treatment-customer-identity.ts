"use client";

import { getCustomerById } from "@/data";
import {
  useCustomerRemoteDetail,
  type CustomerRemoteReadState,
} from "@/features/customers/use-customer-remote-read";
import {
  resolveTreatmentCustomerIdentitySource,
  type TreatmentIdentitySource,
} from "@/lib/treatments/treatment-identity";
import type { Customer } from "@/types";

export type TreatmentCustomerIdentity =
  | { status: "missing-id" }
  | { status: "loading"; source: TreatmentIdentitySource }
  | { status: "error"; source: "remote"; message: string }
  | { status: "empty"; source: TreatmentIdentitySource }
  | { status: "ready"; source: TreatmentIdentitySource; customer: Customer };

export function useTreatmentCustomerIdentity(input: {
  organizationId: string;
  customerId: string;
  customerRemoteReadPilot: boolean;
}): TreatmentCustomerIdentity {
  const source = resolveTreatmentCustomerIdentitySource(input.customerRemoteReadPilot);
  const remote = useCustomerRemoteDetail(
    input.organizationId,
    input.customerId,
    source === "remote",
  );

  if (!input.customerId) return { status: "missing-id" };
  if (source === "remote") return fromRemoteState(remote);
  const local = getCustomerById(input.customerId, input.organizationId);
  return local
    ? { status: "ready", source: "local", customer: local }
    : { status: "empty", source: "local" };
}

function fromRemoteState(
  remote: CustomerRemoteReadState<Customer>,
): TreatmentCustomerIdentity {
  if (remote.status === "off" || remote.status === "loading") {
    return { status: "loading", source: "remote" };
  }
  if (remote.status === "error") {
    return { status: "error", source: "remote", message: remote.message };
  }
  if (remote.status === "empty") return { status: "empty", source: "remote" };
  return { status: "ready", source: "remote", customer: remote.value };
}
