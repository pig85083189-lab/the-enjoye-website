"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  SERVICE_CATALOG_STEPS,
  parseServiceCatalogDraft,
  validateServiceCatalogStep,
  type ServiceCatalogDraft,
  type ServiceCatalogStep,
} from "@/lib/services/service-catalog-derived";
import { submitServiceRemoteCreate } from "@/features/services/use-service-remote-write";
import { serviceWriteUserMessage } from "@/lib/services/service-write-ui-error";
import { createService, updateService } from "@/lib/services/store";
import { cn } from "@/lib/utils";

interface ServiceFormDialogProps {
  open: boolean;
  mode: "create" | "edit";
  remoteWritePilot?: boolean;
  organizationId: string;
  staffId: string;
  serviceId?: string;
  draft: ServiceCatalogDraft;
  onClose: () => void;
  onSaved: (serviceId: string) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

const fieldClass =
  "h-11 min-h-11 w-full min-w-0 rounded-xl border border-border bg-surface px-3 text-[14px] text-text outline-none ring-primary/30 focus-visible:ring-2";
const labelClass = "mb-1.5 block text-sm font-medium text-text";

export function ServiceFormDialog({
  open,
  mode,
  remoteWritePilot = false,
  organizationId,
  staffId,
  serviceId,
  draft: initialDraft,
  onClose,
  onSaved,
}: ServiceFormDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<ServiceCatalogStep>(1);
  const [draft, setDraft] = useState<ServiceCatalogDraft>(initialDraft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = node?.querySelector<HTMLElement>("[data-service-catalog-name]");
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const items = Array.from(dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (item) => !item.hasAttribute("disabled") && item.tabIndex !== -1,
      );
      if (items.length === 0) return;
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      if (event.shiftKey && document.activeElement === firstItem) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && document.activeElement === lastItem) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      const trigger = document.querySelector<HTMLElement>("[data-service-catalog-add]");
      (trigger ?? previous)?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const title = mode === "edit" ? "編輯服務" : "新增服務";

  function setField<K extends keyof ServiceCatalogDraft>(key: K, value: ServiceCatalogDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError("");
  }

  function goNext() {
    const invalid = validateServiceCatalogStep(step, draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setStep(2);
  }

  async function submit() {
    const parsed = parseServiceCatalogDraft(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      setStep(1);
      return;
    }
    setBusy(true);
    setError("");
    try {
      if (remoteWritePilot) {
        if (mode === "edit") {
          throw new Error("目前僅能新增服務");
        }
        const created = await submitServiceRemoteCreate({
          organizationId,
          name: parsed.value.name,
          category: parsed.value.category || undefined,
          durationMinutes: parsed.value.durationMinutes,
          priceMinor: parsed.value.priceMinor,
          isActive: parsed.value.isActive,
          createdByStaffId: staffId,
        });
        onSaved(created.id);
        onClose();
        return;
      }
      if (mode === "edit" && serviceId) {
        updateService(
          organizationId,
          serviceId,
          {
            name: parsed.value.name,
            category: parsed.value.category || null,
            durationMinutes: parsed.value.durationMinutes,
            priceMinor: parsed.value.priceMinor,
            isActive: parsed.value.isActive,
          },
          staffId,
        );
        onSaved(serviceId);
      } else {
        const created = createService(organizationId, {
          name: parsed.value.name,
          category: parsed.value.category || undefined,
          durationMinutes: parsed.value.durationMinutes,
          priceMinor: parsed.value.priceMinor,
          isActive: parsed.value.isActive,
          createdByStaffId: staffId,
        });
        onSaved(created.id);
      }
      onClose();
    } catch (err) {
      setError(remoteWritePilot ? serviceWriteUserMessage(err) : err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center min-[720px]:items-center">
      <button
        type="button"
        className="absolute inset-0 bg-text/30"
        aria-label="關閉服務表單"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        data-service-catalog-editor
        data-service-catalog-step={step}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(
          "relative z-10 flex w-full max-w-full flex-col overflow-x-hidden overflow-hidden border border-border bg-surface",
          "max-h-[min(92vh,calc(100dvh-3.5rem-env(safe-area-inset-bottom)))] rounded-t-3xl",
          "mb-[calc(3.5rem+env(safe-area-inset-bottom))] min-[720px]:mb-0",
          "min-[720px]:max-h-[min(88vh,720px)] min-[720px]:max-w-[520px] min-[720px]:rounded-3xl",
        )}
      >
        <div className="flex shrink-0 items-center justify-between px-5 pt-4 pb-2">
          <h2 id={titleId} className="text-[16px] font-semibold text-text">
            {title}
          </h2>
          <button
            type="button"
            className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            aria-label="關閉"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <ol className="flex shrink-0 gap-2 px-5 pb-3" aria-label="步驟">
          {SERVICE_CATALOG_STEPS.map((item) => (
            <li
              key={item.id}
              className={cn(
                "flex min-w-0 flex-1 items-center gap-1.5 text-[11px]",
                step === item.id ? "text-text" : "text-secondary-text",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  step === item.id ? "bg-primary text-white" : "bg-[#F1EEEC] text-secondary-text",
                )}
              >
                {item.id}
              </span>
              <span className="truncate">{item.label}</span>
            </li>
          ))}
        </ol>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4">
          {step === 1 ? (
            <div className="space-y-3">
              <label className={labelClass}>
                服務名稱
                <input
                  data-service-catalog-name
                  value={draft.name}
                  onChange={(event) => setField("name", event.target.value)}
                  className={cn(fieldClass, "mt-1.5")}
                  aria-required="true"
                  required
                />
              </label>
              <label className={labelClass}>
                服務分類
                <input
                  value={draft.category}
                  onChange={(event) => setField("category", event.target.value)}
                  className={cn(fieldClass, "mt-1.5")}
                />
              </label>
              <label className={labelClass}>
                服務時長
                <div className="mt-1.5 flex items-center gap-2">
                  <input
                    inputMode="numeric"
                    value={draft.durationInput}
                    onChange={(event) => setField("durationInput", event.target.value)}
                    className={fieldClass}
                    aria-required="true"
                    required
                  />
                  <span className="shrink-0 text-[13px] text-secondary-text">分鐘</span>
                </div>
              </label>
              <label className={labelClass}>
                售價
                <div className="mt-1.5 flex items-center gap-2">
                  <span className="shrink-0 text-[13px] text-secondary-text">NT$</span>
                  <input
                    inputMode="numeric"
                    value={draft.priceInput}
                    onChange={(event) => setField("priceInput", event.target.value)}
                    className={fieldClass}
                    aria-required="true"
                    required
                  />
                </div>
              </label>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <label className="flex min-h-11 items-center justify-between gap-3 rounded-2xl border border-border px-3.5">
                <span className="text-sm font-medium text-text">販售中</span>
                <input
                  type="checkbox"
                  checked={draft.isActive}
                  onChange={(event) => setField("isActive", event.target.checked)}
                  className="h-4 w-4 accent-primary"
                />
              </label>
              <p className="text-[12px] leading-5 text-secondary-text">
                可預約與可銷售隨「販售中」成立。套票方案可選任何服務項目，無需另外標記。
              </p>
              <p className="rounded-2xl bg-[#FAF7F5] px-3.5 py-3 text-[13px] leading-5 text-secondary-text">
                目前服務項目適用整個 Organization
              </p>
            </div>
          ) : null}

          {error ? (
            <p role="alert" className="mt-3 text-[13px] text-[#C49A9A]">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-5 py-3">
          {step === 2 ? (
            <Button
              type="button"
              variant="outline"
              className="h-11 min-h-11 flex-1 rounded-2xl"
              onClick={() => {
                setError("");
                setStep(1);
              }}
            >
              上一步
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              className="h-11 min-h-11 flex-1 rounded-2xl"
              onClick={onClose}
            >
              取消
            </Button>
          )}
          {step === 1 ? (
            <Button
              type="button"
              className="h-11 min-h-11 flex-1 rounded-2xl"
              onClick={goNext}
            >
              下一步
            </Button>
          ) : (
            <Button
              type="button"
              data-service-catalog-save
              className="h-11 min-h-11 flex-1 rounded-2xl"
              disabled={busy}
              onClick={submit}
            >
              {busy ? "儲存中…" : "儲存"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
