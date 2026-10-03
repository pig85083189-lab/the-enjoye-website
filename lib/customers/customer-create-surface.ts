/**
 * Customer list create-button surface.
 * Remote-read pilot is read-only: do not open the local ConsultationWizard
 * and do not invent a remote customer write path.
 */

export const CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON =
  "遠端客戶建立尚未開放";

export type CustomerListCreateSurface =
  | { mode: "local-create"; href: "/staff/customers/new"; disabled: false }
  | {
      mode: "remote-read-only";
      href: null;
      disabled: true;
      reason: typeof CUSTOMER_REMOTE_CREATE_UNAVAILABLE_REASON;
    };

export function resolveCustomerListCreateSurface(
  remoteReadPilot: boolean,
): CustomerListCreateSurface {
  if (remoteReadPilot) {
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
