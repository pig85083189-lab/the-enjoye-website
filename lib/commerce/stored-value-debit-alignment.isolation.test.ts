import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { completeStoredValueDebit } from "@/lib/commerce/stored-value-debit-alignment";

const ROOT = process.cwd();

function read(rel: string): string {
  return readFileSync(path.join(ROOT, rel), "utf8");
}

function topUpBody(source: string): string {
  const start = source.indexOf("create or replace function public.post_stored_value_top_up_v1");
  const end = source.indexOf("revoke all on function public.post_stored_value_top_up_v1");
  return source.slice(start, end).trim();
}

describe("stored value debit alignment", () => {
  it("posts a pending receipt after one debit", async () => {
    let debits = 0;
    let commits = 0;
    let abandons = 0;
    const status = await completeStoredValueDebit({
      expectedEffectKey: "booking-checkout:sale-1",
      claim: async () => "PENDING",
      debit: async () => {
        debits += 1;
        return { effectKey: "booking-checkout:sale-1" };
      },
      commit: async () => {
        commits += 1;
      },
      abandon: async () => {
        abandons += 1;
      },
    });
    expect(status).toBe("POSTED");
    expect(debits).toBe(1);
    expect(commits).toBe(1);
    expect(abandons).toBe(0);
  });

  it("does not debit again when the receipt is already posted", async () => {
    let debits = 0;
    await completeStoredValueDebit({
      expectedEffectKey: "booking-checkout:sale-1",
      claim: async () => "POSTED",
      debit: async () => {
        debits += 1;
        return { effectKey: "booking-checkout:sale-1" };
      },
      commit: async () => {
        throw new Error("commit");
      },
      abandon: async () => {
        throw new Error("abandon");
      },
    });
    expect(debits).toBe(0);
  });

  it("fails a definite LINE rejection and leaves a timeout pending", async () => {
    let abandons = 0;
    await expect(completeStoredValueDebit({
      expectedEffectKey: "booking-checkout:sale-1",
      claim: async () => "PENDING",
      debit: async () => {
        throw new Error("必須先完成 LINE 會員綁定");
      },
      commit: async () => {
        throw new Error("commit");
      },
      abandon: async () => {
        abandons += 1;
      },
    })).rejects.toThrow("必須先完成 LINE 會員綁定");
    expect(abandons).toBe(1);

    abandons = 0;
    await expect(completeStoredValueDebit({
      expectedEffectKey: "booking-checkout:sale-1",
      claim: async () => "PENDING",
      debit: async () => {
        throw new Error("fetch failed");
      },
      commit: async () => {
        throw new Error("commit");
      },
      abandon: async () => {
        abandons += 1;
      },
    })).rejects.toThrow("fetch failed");
    expect(abandons).toBe(0);
  });

  it("keeps the receipt pending when posting it fails after the debit", async () => {
    let abandons = 0;
    let debits = 0;
    await expect(completeStoredValueDebit({
      expectedEffectKey: "booking-checkout:sale-1",
      claim: async () => "PENDING",
      debit: async () => {
        debits += 1;
        return { effectKey: "booking-checkout:sale-1" };
      },
      commit: async () => {
        throw new Error("timeout");
      },
      abandon: async () => {
        abandons += 1;
      },
    })).rejects.toThrow("timeout");
    expect(debits).toBe(1);
    expect(abandons).toBe(0);
  });

  it("uses one LINE gate and does not debit before the receipt claim", () => {
    const migration = read("supabase/migrations/20261116143000_stored_value_line_checkout_gate.sql");
    const topUp = read("supabase/beauty-os/stored_value_top_up_line_gate_v2.sql");
    const line = read("supabase/migrations/20261116120000_line_verified_booking_source_link.sql");
    const receipt = read("supabase/booking/20261115171000_checkout_stored_value_receipt.sql");
    const route = read("app/api/staff/commerce/checkout/route.ts");
    expect(topUpBody(migration)).toBe(topUpBody(topUp));
    expect(migration).toMatch(/customer_line_membership_is_current\(v_org, v_wallet\)/);
    expect(migration).not.toMatch(/\bBEGIN\b|\bCOMMIT\b/);
    expect(topUp).not.toMatch(/REVIEW ONLY/);
    expect(topUp).toMatch(/customer_line_membership_is_current\(p_organization_id, p_customer_id\)/);
    expect(line).not.toMatch(/Do not apply to production in this phase/);
    expect(line).toMatch(/20261116143000_stored_value_line_checkout_gate\.sql/);
    expect(receipt).toMatch(/claim_stored_value_debit_receipt/);
    expect(receipt).toMatch(/booking-checkout:/);
    expect(receipt).not.toMatch(/stored_value_ledger_entries/);
    expect(receipt).not.toMatch(/Do not apply this file to the finance database or to production until/);
    expect(route).toMatch(/completeStoredValueDebit/);
    expect(route).toMatch(/claim_stored_value_debit_receipt/);
    expect(route.indexOf("claim_stored_value_debit_receipt")).toBeLessThan(
      route.indexOf("settle_booking_source_checkout"),
    );
    expect(route).not.toMatch(/status:\s*"POSTED"/);
  });
});
