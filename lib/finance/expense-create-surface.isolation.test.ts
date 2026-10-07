import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseExpenseAmountInput, parseExpenseFormDraft } from "@/lib/finance/expense-form";
import { EXPENSE_WRITE_UI, expenseWriteUserMessage } from "@/lib/finance/expense-write-ui-error";
import { ExpenseWriteUnauthorizedError } from "@/lib/finance/expense-write-guard";
import { isGeneratedExpenseAppId } from "@/lib/finance/expense";
import { EXPENSE_CATEGORY_LABEL, EXPENSE_PAYMENT_METHOD_LABEL } from "@/lib/finance/domain";

function source(rel: string): string {
  return readFileSync(path.join(process.cwd(), rel), "utf8");
}

describe("expense create surface", () => {
  it("validates required fields with specific messages and allows blank optionals", () => {
    expect(parseExpenseFormDraft({
      expenseDate: "",
      category: "RENT",
      name: "店租",
      amount: "23000",
      paymentMethod: "",
      vendor: "",
      note: "",
    }).ok).toBe(false);
    expect(parseExpenseFormDraft({
      expenseDate: "2026-10-06",
      category: "",
      name: "店租",
      amount: "23000",
      paymentMethod: "",
      vendor: "",
      note: "",
    })).toEqual({ ok: false, error: EXPENSE_WRITE_UI.category });
    expect(parseExpenseFormDraft({
      expenseDate: "2026-10-06",
      category: "RENT",
      name: "   ",
      amount: "23000",
      paymentMethod: "",
      vendor: "",
      note: "",
    })).toEqual({ ok: false, error: EXPENSE_WRITE_UI.name });
    expect(parseExpenseFormDraft({
      expenseDate: "2026-10-06",
      category: "RENT",
      name: "10 月店租",
      amount: "0",
      paymentMethod: "",
      vendor: "",
      note: "",
    })).toEqual({ ok: false, error: EXPENSE_WRITE_UI.amount });
    expect(parseExpenseAmountInput("23000")).toBe(23000);
    expect(parseExpenseAmountInput("NT$23,000")).toBe(23000);
    expect(parseExpenseAmountInput("0")).toBeNull();
    const parsed = parseExpenseFormDraft({
      expenseDate: "2026-10-06",
      category: "RENT",
      name: "  10 月店租  ",
      amount: "23000",
      paymentMethod: "",
      vendor: "",
      note: "",
    });
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.amountMinor).toBe(23000);
      expect(parsed.value.paymentMethod).toBeNull();
      expect(parsed.value.vendor).toBe("");
      expect(parsed.value.name).toBe("10 月店租");
    }
    expect(expenseWriteUserMessage(new ExpenseWriteUnauthorizedError())).toBe(
      EXPENSE_WRITE_UI.unauthorized,
    );
    expect(isGeneratedExpenseAppId("exp-mabc123-xyz789")).toBe(true);
    expect(isGeneratedExpenseAppId("uuid-not-allowed")).toBe(false);
  });

  it("keeps Chinese labels in UI and canonical English in DB values", () => {
    expect(EXPENSE_CATEGORY_LABEL.RENT).toBe("店租");
    expect(EXPENSE_CATEGORY_LABEL.PRODUCTS).toBe("產品進貨");
    expect(EXPENSE_CATEGORY_LABEL.MAINTENANCE).toBe("維修");
    expect(EXPENSE_CATEGORY_LABEL.FEES).toBe("手續費");
    expect(EXPENSE_PAYMENT_METHOD_LABEL.CARD).toBe("刷卡");
    expect(EXPENSE_PAYMENT_METHOD_LABEL.TRANSFER).toBe("轉帳");
    const dialog = source("features/finance/ExpenseFormDialog.tsx");
    expect(dialog).toMatch(/日期 \*/);
    expect(dialog).toMatch(/分類 \*/);
    expect(dialog).toMatch(/支出名稱 \*/);
    expect(dialog).toMatch(/金額 \*/);
    expect(dialog).toMatch(/付款方式/);
    expect(dialog).toMatch(/廠商 \/ 收款人/);
    expect(dialog).toMatch(/備註/);
    expect(dialog).not.toMatch(/type="file"|receipt_url|收據照片/);
    expect(dialog).toMatch(/busy \? "儲存中…" : "儲存"/);
    expect(dialog).toMatch(/disabled=\{busy/);
    expect(dialog).toMatch(/appIdRef/);
    expect(dialog).toMatch(/newId\("exp"\)/);
    expect(dialog).not.toMatch(/localStorage/);
    expect(dialog).not.toMatch(/\* 100/);
    const page = source("features/finance/FinanceExpensesPageClient.tsx");
    expect(page).toMatch(/ExpenseFormDialog/);
    expect(page).toMatch(/新增支出/);
    expect(page).toMatch(/支出記帳尚未開放/);
    expect(page).toMatch(/sheetOpen && writeOpen/);
    expect(page).toMatch(/建立人/);
    expect(page).toMatch(/ctx\.refreshFinance\(\)/);
    expect(page).not.toMatch(/optimistic/);
  });
});
