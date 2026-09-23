import type { Service } from "@/types";
import { DEFAULT_SERVICE_PRICE_MINOR } from "./domain";
import { assertNonNegativeMoney } from "./money";

/**
 * Canonical service list price in minor units.
 * Never map by service display name.
 */
export function getServicePriceMinor(service: Service): number {
  if (typeof service.priceMinor === "number") {
    return assertNonNegativeMoney(service.priceMinor, "service.priceMinor");
  }
  return DEFAULT_SERVICE_PRICE_MINOR;
}
