import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkoutConfirmCtaLabel } from "@/lib/commerce/transaction-tender-presentation";
import { packageRedemptionFromRemoteJson } from "@/lib/persistence/commerce-mapping";

const ROOT = process.cwd();

describe("Checkout package / stored-value presentation", () => {
  it("C. CTA switches on package selection and cancel restores cash CTA", () => {
    const before = checkoutConfirmCtaLabel({
      packageRedemption: null,
      dueMinor: 1800,
    });
    const selected = checkoutConfirmCtaLabel({
      packageRedemption: {
        customerPackageId: "cpkg-1",
        serviceId: "svc-muw54el4-7omtyn",
        sessions: 1,
      },
      dueMinor: 0,
    });
    const cancelled = checkoutConfirmCtaLabel({
      packageRedemption: null,
      dueMinor: 1800,
    });
    expect(before).toBe("確認收款 NT$1,800");
    expect(selected).toBe("確認使用 1 堂並完成結帳");
    expect(selected).not.toMatch(/確認收款 NT\$1,800/);
    expect(cancelled).toBe("確認收款 NT$1,800");
  });

  it("D. Stored Value WRITE OFF does not mark Package as a closed payment method", () => {
    const panel = readFileSync(
      path.join(ROOT, "features/checkout/CheckoutPanel.tsx"),
      "utf8",
    );
    expect(panel).toMatch(/data-checkout-package-section/);
    expect(panel).toMatch(/套票核銷/);
    expect(panel).toMatch(/可使用下方套票折抵本次服務/);
    expect(panel).toMatch(/data-checkout-stored-value-section/);
    expect(panel).toMatch(/尚未開放儲值金付款/);
    expect(panel).toMatch(/id: "package", label: "套票"/);
    expect(panel).toMatch(/id: "stored", label: "儲值"/);
    expect(panel).not.toMatch(/套票 \/ 儲值/);
    const packageBlock = panel.slice(
      panel.indexOf('tab === "package"'),
      panel.indexOf('tab === "stored"'),
    );
    expect(packageBlock).not.toMatch(/此付款方式目前尚未開放/);
    expect(packageBlock).toMatch(/使用 1 堂/);
    expect(packageBlock).toMatch(/取消核銷/);
    expect(panel).toMatch(/checkoutConfirmCtaLabel/);
    expect(panel).toMatch(/setPackageRedemption/);
    expect(panel).not.toMatch(/redeemPackage|session_delta/);
  });

  it("maps remote packageRedemption by customerPackageId / serviceId only", () => {
    expect(
      packageRedemptionFromRemoteJson({
        customerPackageId: "cpkg-fb626441e6df43",
        serviceId: "svc-muw54el4-7omtyn",
        sessions: 1,
      }),
    ).toEqual({
      customerPackageId: "cpkg-fb626441e6df43",
      serviceId: "svc-muw54el4-7omtyn",
      sessions: 1,
    });
    expect(packageRedemptionFromRemoteJson({ serviceId: "svc-x" })).toBeUndefined();
    expect(packageRedemptionFromRemoteJson(null)).toBeUndefined();
  });
});
