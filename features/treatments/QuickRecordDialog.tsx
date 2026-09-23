"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface QuickRecordDialogProps {
  open: boolean;
  templateName: string;
  onConfirm: () => void;
  onCancel: () => void;
}

const APPLY_ITEMS = [
  "上次追蹤重點",
  "上次今日評估相關資料",
  "本課程標準操作流程",
  "上次常用產品",
  "上次 Follow Up（如果存在）",
];

const SKIP_ITEMS = ["照片", "專業紀錄全文", "不舒服備註"];

export function QuickRecordDialog({
  open,
  templateName,
  onConfirm,
  onCancel,
}: QuickRecordDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(48,43,43,0.35)] sm:items-center sm:px-5"
      role="presentation"
      onClick={onCancel}
    >
      <Card
        padding="lg"
        className="w-full max-w-lg rounded-t-3xl sm:rounded-2xl"
        role="dialog"
        aria-modal="true"
        aria-labelledby="quick-record-title"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="quick-record-title" className="text-lg font-semibold text-text">
          快速建立本次紀錄
        </h2>
        <p className="mt-2 text-sm text-secondary-text">
          將依 {templateName} 套用以下內容，仍可稍後修改。
        </p>

        <Section title="將套用">
          <ul className="space-y-1.5">
            {APPLY_ITEMS.map((item) => (
              <li key={item} className="text-[15px] text-text">
                ✓ {item}
              </li>
            ))}
          </ul>
        </Section>

        <Section title="不複製">
          <ul className="space-y-1.5">
            {SKIP_ITEMS.map((item) => (
              <li key={item} className="text-[15px] text-secondary-text">
                · {item}
              </li>
            ))}
          </ul>
        </Section>

        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row-reverse">
          <Button fullWidth onClick={onConfirm}>
            套用並開始
          </Button>
          <Button variant="outline" fullWidth onClick={onCancel}>
            取消
          </Button>
        </div>
      </Card>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl bg-[#FAF7F5] px-4 py-3">
      <p className="text-sm font-medium text-secondary-text">{title}</p>
      <div className="mt-2">{children}</div>
    </div>
  );
}
