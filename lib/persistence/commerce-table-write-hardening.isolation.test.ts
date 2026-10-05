import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE,
  COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE,
} from "./schema-contract";

function read(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("Phase 1C-6H.2P commerce table write hardening", () => {
  const hardening = read(COMMERCE_TABLE_WRITE_HARDENING_MIGRATION_FILE);
  const settlement = read(COMMERCE_REMOTE_SETTLEMENT_MIGRATION_FILE);

  it("revokes direct authenticated writes and keeps select for transaction read", () => {
    for (const table of [
      "checkout_drafts",
      "checkout_items",
      "checkout_discounts",
      "checkout_payments",
      "transactions",
      "transaction_items",
      "transaction_discounts",
      "transaction_payments",
    ]) {
      expect(hardening).toMatch(new RegExp(`revoke all on public\\.${table}`));
      expect(hardening).toMatch(new RegExp(`grant select on public\\.${table} to authenticated`));
    }
    expect(hardening).toMatch(/drop policy if exists checkout_drafts_insert_org/);
    expect(hardening).toMatch(/drop policy if exists checkout_drafts_update_org/);
    expect(hardening).toMatch(/drop policy if exists transactions_insert_org/);
    expect(hardening).toMatch(/drop policy if exists transactions_update_org/);
    expect(hardening).not.toMatch(/create policy checkout_drafts_insert_org/);
    expect(hardening).not.toMatch(/create policy transactions_insert_org/);
    expect(hardening).not.toMatch(/drop table/i);
    expect(hardening).not.toMatch(/\btruncate\s+table\b/i);
    expect(hardening).not.toMatch(/insert into public\.(customers|appointments|treatments|checkout_drafts|transactions)/i);
  });

  it("leaves settlement mutations on authenticated security-definer RPCs", () => {
    expect(settlement).toMatch(/create or replace function public\.hydrate_checkout_from_treatment/);
    expect(settlement).toMatch(/create or replace function public\.save_checkout_draft/);
    expect(settlement).toMatch(/create or replace function public\.settle_checkout_draft/);
    expect(settlement).toMatch(/staff_role_can_checkout/);
    expect(settlement).toMatch(/select role in \('OWNER', 'MANAGER', 'STAFF', 'RECEPTIONIST'\)/);
    expect(settlement).toMatch(/grant execute on function public\.hydrate_checkout_from_treatment/);
    expect(settlement).toMatch(/grant execute on function public\.settle_checkout_draft/);
    expect(settlement).toMatch(/grant execute on function public\.commerce_list_transactions/);
    expect(hardening).not.toMatch(/revoke all on function public\.settle_checkout_draft/);
    expect(hardening).not.toMatch(/revoke all on function public\.commerce_list_transactions/);
  });

  it("keeps Package / Stored Value remote settlement disabled", () => {
    expect(settlement).toMatch(/此付款方式目前尚未開放/);
    expect(settlement).toMatch(/method in \('STORED_VALUE', 'PACKAGE'\)/);
    expect(hardening).not.toMatch(/STORED_VALUE|PACKAGE/);
  });
});
