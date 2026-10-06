"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import {
  addPlanService,
  availablePlanServices,
  PACKAGE_PLAN_STEPS,
  parsePackagePlanDraft,
  removePlanService,
  validatePackagePlanStep,
  type PackagePlanDraft,
  type PackagePlanServiceOption,
  type PackagePlanStep,
  type PackagePlanValidityMode,
} from "@/lib/packages/package-plans-derived";
import { submitPackageRemoteCreate } from "@/features/packages/use-package-remote-write";
import { packageWriteUserMessage } from "@/lib/packages/package-write-ui-error";
import {
  createPackageDefinition,
  updatePackageDefinition,
} from "@/lib/packages/store";
import { cn } from "@/lib/utils";

interface PackagePlanEditorDialogProps {
  open: boolean;
  mode: "create" | "edit";
  remoteWritePilot?: boolean;
  organizationId: string;
  staffId: string;
  currentLocationName: string;
  services: PackagePlanServiceOption[];
  draft: PackagePlanDraft;
  definitionId?: string;
  canManage: boolean;
  onClose: () => void;
  onSaved: (definitionId: string) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function PackagePlanEditorDialog({
  open,
  mode,
  remoteWritePilot = false,
  organizationId,
  staffId,
  currentLocationName,
  services,
  draft: initialDraft,
  definitionId,
  canManage,
  onClose,
  onSaved,
}: PackagePlanEditorDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<PackagePlanStep>(1);
  const [draft, setDraft] = useState<PackagePlanDraft>(initialDraft);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingServiceId, setPendingServiceId] = useState("");

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = node?.querySelector<HTMLElement>("[data-package-plan-name]");
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
      const trigger = document.querySelector<HTMLElement>("[data-package-plan-add]");
      (trigger ?? previous)?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  const available = availablePlanServices(services, draft.includedServiceIds);
  const title = mode === "edit" ? "編輯套票方案" : "新增套票方案";

  function setField<K extends keyof PackagePlanDraft>(key: K, value: PackagePlanDraft[K]) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError("");
  }

  function goNext() {
    const invalid = validatePackagePlanStep(step, draft);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setStep((current) => (current < 3 ? ((current + 1) as PackagePlanStep) : current));
  }

  function goBack() {
    setError("");
    setStep((current) => (current > 1 ? ((current - 1) as PackagePlanStep) : current));
  }

  function addService() {
    const nextId = pendingServiceId || available[0]?.id;
    if (!nextId) return;
    setDraft((prev) => ({
      ...prev,
      includedServiceIds: addPlanService(prev.includedServiceIds, nextId),
    }));
    setPendingServiceId("");
    setError("");
  }

  async function submit() {
    if (!canManage) {
      setError("沒有權限管理套票方案");
      return;
    }
    const parsed = parsePackagePlanDraft(draft);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    setBusy(true);
    try {
      if (remoteWritePilot) {
        if (mode === "edit") {
          throw new Error("目前僅能新增套票方案");
        }
        const created = await submitPackageRemoteCreate({
          organizationId,
          name: parsed.value.name,
          description: parsed.value.description,
          includedServiceIds: parsed.value.includedServiceIds,
          sessionCount: parsed.value.sessionCount,
          priceMinor: parsed.value.priceMinor,
          validityDays: parsed.value.validityDays ?? undefined,
          isActive: parsed.value.isActive,
          createdByStaffId: staffId,
        });
        onSaved(created.id);
        return;
      }
      if (mode === "edit" && definitionId) {
        const updated = updatePackageDefinition(
          organizationId,
          definitionId,
          {
            name: parsed.value.name,
            description: parsed.value.description ?? "",
            includedServiceIds: parsed.value.includedServiceIds,
            sessionCount: parsed.value.sessionCount,
            priceMinor: parsed.value.priceMinor,
            validityDays: parsed.value.validityDays ?? null,
            isActive: parsed.value.isActive,
          },
          staffId,
        );
        onSaved(updated.id);
        return;
      }
      const created = createPackageDefinition(organizationId, {
        name: parsed.value.name,
        description: parsed.value.description,
        includedServiceIds: parsed.value.includedServiceIds,
        sessionCount: parsed.value.sessionCount,
        priceMinor: parsed.value.priceMinor,
        validityDays: parsed.value.validityDays ?? undefined,
        createdByStaffId: staffId,
      });
      if (!parsed.value.isActive) {
        updatePackageDefinition(
          organizationId,
          created.id,
          { isActive: false },
          staffId,
        );
      }
      onSaved(created.id);
    } catch (err) {
      setError(remoteWritePilot ? packageWriteUserMessage(err) : err instanceof Error ? err.message : "儲存失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center min-[720px]:items-center min-[720px]:px-5"
      data-package-plan-editor-root
    >
      <button
        type="button"
        className="absolute inset-0 bg-text/30"
        aria-label="關閉套票方案編輯"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        data-package-plan-editor
        data-package-plan-step={step}
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
          {PACKAGE_PLAN_STEPS.map((item) => (
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
              <label className="block text-[12px] text-secondary-text">
                套票名稱 *
                <input
                  data-package-plan-name
                  value={draft.name}
                  onChange={(event) => setField("name", event.target.value)}
                  placeholder="例如：性感美胸 SPA 10 堂"
                  className="mt-1 h-11 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                />
              </label>
              <label className="block text-[12px] text-secondary-text">
                方案說明
                <textarea
                  value={draft.description}
                  onChange={(event) => setField("description", event.target.value)}
                  rows={3}
                  placeholder="選填"
                  className="mt-1 w-full rounded-xl border border-border bg-surface px-3 py-2 text-[14px] text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                />
              </label>
              <label className="block text-[12px] text-secondary-text">
                售價 *（NT$）
                <input
                  data-package-plan-price
                  inputMode="numeric"
                  value={draft.priceInput}
                  onChange={(event) => setField("priceInput", event.target.value)}
                  placeholder="22000"
                  className="mt-1 h-11 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] tabular-nums text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                />
              </label>
              <fieldset className="min-w-0">
                <legend className="text-[12px] text-secondary-text">有效期限</legend>
                <div className="mt-1.5 flex min-w-0 flex-wrap gap-1.5">
                  {(
                    [
                      ["none", "無固定期限"],
                      ["180", "180 天"],
                      ["365", "365 天"],
                      ["custom", "自訂"],
                    ] as Array<[PackagePlanValidityMode, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setField("validityMode", id)}
                      className={cn(
                        "h-8 min-h-8 rounded-full px-3 text-[12px] font-medium",
                        draft.validityMode === id
                          ? "bg-primary text-white"
                          : "bg-[#F6F1EE] text-text",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {draft.validityMode === "custom" ? (
                  <input
                    data-package-plan-validity
                    inputMode="numeric"
                    value={draft.customValidityDays}
                    onChange={(event) => setField("customValidityDays", event.target.value)}
                    placeholder="天數"
                    className="mt-2 h-11 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] tabular-nums text-text outline-none ring-primary/30 focus:ring-2"
                    aria-label="自訂有效天數"
                  />
                ) : null}
              </fieldset>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <p className="text-[13px] text-secondary-text">
                加入既有療程。堂數是方案共用餘額，核銷任一適用療程時各扣 1 堂。
              </p>
              {draft.includedServiceIds.length === 0 ? (
                <p className="rounded-xl bg-[#FAF7F5] px-3 py-2.5 text-[13px] text-secondary-text">
                  尚未加入療程
                </p>
              ) : (
                <ul className="divide-y divide-[#EFE8E4] overflow-hidden rounded-2xl border border-border">
                  {draft.includedServiceIds.map((serviceId) => {
                    const service = services.find((row) => row.id === serviceId);
                    return (
                      <li
                        key={serviceId}
                        className="flex min-h-12 items-center justify-between gap-2 px-3 py-2"
                      >
                        <span className="min-w-0 truncate text-[14px] text-text">
                          {service?.name ?? serviceId}
                        </span>
                        <button
                          type="button"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-full text-secondary-text hover:bg-primary-light/50"
                          aria-label={`移除${service?.name ?? "療程"}`}
                          onClick={() =>
                            setDraft((prev) => ({
                              ...prev,
                              includedServiceIds: removePlanService(
                                prev.includedServiceIds,
                                serviceId,
                              ),
                            }))
                          }
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
              {available.length > 0 ? (
                <div className="flex min-w-0 items-center gap-2">
                  <select
                    value={pendingServiceId || available[0]?.id || ""}
                    onChange={(event) => setPendingServiceId(event.target.value)}
                    className="h-11 min-h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-[14px] text-text"
                    aria-label="選擇療程"
                  >
                    {available.map((row) => (
                      <option key={row.id} value={row.id}>
                        {row.name}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="outline"
                    data-package-plan-add-service
                    className="h-11 min-h-11 shrink-0 rounded-xl px-3 text-[13px]"
                    onClick={addService}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden />
                    新增療程
                  </Button>
                </div>
              ) : null}
              <label className="block text-[12px] text-secondary-text">
                總堂數 *（共用）
                <input
                  data-package-plan-sessions
                  inputMode="numeric"
                  value={draft.sessionCountInput}
                  onChange={(event) => setField("sessionCountInput", event.target.value)}
                  placeholder="10"
                  className="mt-1 h-11 min-h-11 w-full rounded-xl border border-border bg-surface px-3 text-[14px] tabular-nums text-text outline-none ring-primary/30 placeholder:text-secondary-text focus:ring-2"
                />
              </label>
              {draft.includedServiceIds.length > 1 ? (
                <p className="text-[12px] text-secondary-text">
                  此為組合套票：適用多項療程，共用 {draft.sessionCountInput || "—"} 堂。
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <div className="rounded-2xl border border-border bg-[#FAF7F5] px-3.5 py-3">
                <p className="text-[12px] text-secondary-text">適用分店</p>
                <p className="mt-1 text-[14px] font-medium text-text">
                  {currentLocationName || "目前分店"}
                </p>
                <p className="mt-1 text-[12px] text-secondary-text">
                  方案適用全組織分店。結帳時會記錄實際販售分店，這裡不會另外限制可售分店。
                </p>
              </div>
              <fieldset>
                <legend className="text-[12px] text-secondary-text">方案狀態</legend>
                <div className="mt-1.5 flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setField("isActive", true)}
                    className={cn(
                      "h-8 min-h-8 rounded-full px-3 text-[12px] font-medium",
                      draft.isActive ? "bg-primary text-white" : "bg-[#F6F1EE] text-text",
                    )}
                  >
                    販售中
                  </button>
                  <button
                    type="button"
                    onClick={() => setField("isActive", false)}
                    className={cn(
                      "h-8 min-h-8 rounded-full px-3 text-[12px] font-medium",
                      !draft.isActive ? "bg-primary text-white" : "bg-[#F6F1EE] text-text",
                    )}
                  >
                    停售
                  </button>
                </div>
              </fieldset>
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-sm text-[#B07A4A]" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="flex shrink-0 gap-2 border-t border-border px-5 py-3">
          {step === 1 ? (
            <Button
              variant="outline"
              className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
              onClick={onClose}
            >
              取消
            </Button>
          ) : (
            <Button
              variant="outline"
              className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
              onClick={goBack}
            >
              上一步
            </Button>
          )}
          {step < 3 ? (
            <Button className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]" onClick={goNext}>
              下一步
            </Button>
          ) : (
            <Button
              data-package-plan-submit
              className="h-11 min-h-11 flex-1 rounded-2xl text-[14px]"
              disabled={busy || !canManage}
              onClick={submit}
            >
              {mode === "edit" ? "儲存方案" : "建立套票方案"}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
