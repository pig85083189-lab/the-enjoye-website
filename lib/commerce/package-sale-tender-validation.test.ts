import { describe, expect, it } from "vitest";
import { validatePackageSaleTenders } from "./package-sale-tender-validation";

describe("package sale tender validation", () => {
  it("accepts exact single payment", () => {
    expect(validatePackageSaleTenders([{ method: "CASH", amount: 10000 }], 10000))
      .toEqual([{ method: "CASH", amount: 10000 }]);
  });
  it("accepts exact mixed payment", () => {
    expect(validatePackageSaleTenders([
      { method: "CASH", amount: 4000 },
      { method: "CARD", amount: 6000, reference: "receipt-1" },
    ], 10000)).toHaveLength(2);
  });
  it.each([
    [{ method: "CASH", amount: 9999 }],
    [{ method: "CASH", amount: 10001 }],
    [{ method: "CASH", amount: 0 }],
    [{ method: "CASH", amount: -1 }],
    [{ method: "CASH", amount: 0.5 }],
    [{ method: "CASH", amount: "10000" }],
    [{ method: "STORED_VALUE", amount: 10000 }],
    [{ method: "PACKAGE", amount: 10000 }],
    [{ method: "CASH", amount: 5000 }, { method: "CASH", amount: 5000 }],
    [{ method: "CASH", amount: 10000, actorId: "other" }],
  ].map(payments => [payments] as [unknown]))("rejects invalid or unsafe tender %j", (payments) => {
    expect(() => validatePackageSaleTenders(payments, 10000)).toThrow();
  });
  it("rejects unsafe totals and empty payment", () => {
    expect(() => validatePackageSaleTenders([], 10000)).toThrow();
    expect(() => validatePackageSaleTenders([{ method: "CASH", amount: 1 }], 0)).toThrow();
    expect(() => validatePackageSaleTenders([{ method: "CASH", amount: Number.MAX_SAFE_INTEGER }, { method: "CARD", amount: 1 }], Number.MAX_SAFE_INTEGER)).toThrow();
  });
});
