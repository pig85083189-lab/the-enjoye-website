import {
  EXTERNAL_PAYMENT_METHODS,
  type PaymentMethod,
} from "./domain";
import { COMMERCE_PAYMENT_UNAVAILABLE_MESSAGE } from "./commerce-remote-write-errors";

export const REMOTE_CHECKOUT_PAYMENT_METHODS: PaymentMethod[] = [
  ...EXTERNAL_PAYMENT_METHODS,
];

export const REMOTE_DISABLED_PAYMENT_METHODS: PaymentMethod[] = [
  "STORED_VALUE",
  "PACKAGE",
];

export function isRemoteCheckoutPaymentMethod(
  method: PaymentMethod,
): method is Exclude<PaymentMethod, "STORED_VALUE" | "PACKAGE"> {
  return (REMOTE_CHECKOUT_PAYMENT_METHODS as readonly string[]).includes(method);
}

export function assertRemoteCheckoutPaymentMethod(method: PaymentMethod): void {
  if (!isRemoteCheckoutPaymentMethod(method)) {
    throw new Error(COMMERCE_PAYMENT_UNAVAILABLE_MESSAGE);
  }
}
