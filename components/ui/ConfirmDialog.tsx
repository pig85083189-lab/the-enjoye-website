"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "離開",
  cancelLabel = "繼續填寫",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(48,43,43,0.35)] px-5"
      role="presentation"
      onClick={onCancel}
    >
      <Card
        padding="lg"
        className="w-full max-w-md"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-dialog-title"
        aria-describedby="leave-dialog-desc"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 id="leave-dialog-title" className="text-lg font-semibold text-text">
          {title}
        </h2>
        <p id="leave-dialog-desc" className="mt-2 text-[15px] leading-relaxed text-secondary-text">
          {description}
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row-reverse">
          <Button fullWidth onClick={onConfirm}>
            {confirmLabel}
          </Button>
          <Button variant="outline" fullWidth onClick={onCancel}>
            {cancelLabel}
          </Button>
        </div>
      </Card>
    </div>
  );
}
