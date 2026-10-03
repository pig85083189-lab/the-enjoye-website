/**
 * Customer list create-button surface.
 * Remote-read without write stays disabled.
 * Remote-write re-enables /staff/customers/new on the authenticated remote path.
 * Local ConsultationWizard remains only when both pilots are off.
 */

export const CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON =
  "遠端客戶建立尚未開放";

export type CustomerListCreateSurface =
  | { mode: "local-create"; href: "/staff/customers/new"; disabled: false }
  | { mode: "remote-create"; href: "/staff/customers/new"; disabled: false }
  | {
      mode: "remote-read-only";
      href: null;
      disabled: true;
      reason: typeof CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON;
    };

export function resolveCustomerListCreateSurface(input: {
  remoteReadPilot: boolean;
  remoteWritePilot?: boolean;
}): CustomerListCreateSurface {
  if (input.remoteWritePilot) {
    return {
      mode: "remote-create",
      href: "/staff/customers/new",
      disabled: false,
    };
  }
  if (input.remoteReadPilot) {
    return {
      mode: "remote-read-only",
      href: null,
      disabled: true,
      reason: CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON,
    };
  }
  return {
    mode: "local-create",
    href: "/staff/customers/new",
    disabled: false,
  };
}
