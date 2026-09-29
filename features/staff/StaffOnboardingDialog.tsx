"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { createStaffOnboardingFromDraft } from "@/lib/staff/staff-onboarding";
import {
  applyOnboardingHoursPattern,
  canManageStaff,
  emptyOnboardingDraft,
  STAFF_HAS_AUTH_ACCOUNT_CREATE,
  STAFF_ONBOARDING_ROLES,
  STAFF_ONBOARDING_STEPS,
  STAFF_ROLE_PRESENTATION,
  staffOnboardingDayLabel,
  toggleOnboardingLocation,
  validateOnboardingStep,
  type StaffOnboardingDraft,
  type StaffOnboardingStep,
} from "@/lib/staff/staff-onboarding-derived";
import type { Location, StaffMembership, StaffRole } from "@/types/saas";
import { cn } from "@/lib/utils";

interface StaffOnboardingDialogProps {
  open: boolean;
  organizationId: string;
  locations: Location[];
  actorRole: StaffRole | undefined;
  defaultLocationId?: string;
  onClose: () => void;
  onCreated: (result: {
    membership: StaffMembership;
    scheduleError: string | null;
  }) => void;
}

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function StaffOnboardingDialog({
  open,
  organizationId,
  locations,
  actorRole,
  defaultLocationId,
  onClose,
  onCreated,
}: StaffOnboardingDialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const [step, setStep] = useState<StaffOnboardingStep>(1);
  const [draft, setDraft] = useState<StaffOnboardingDraft>(() =>
    emptyOnboardingDraft(defaultLocationId),
  );
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const canManage = canManageStaff(actorRole);

  useEffect(() => {
    if (!open) return;
    const node = dialogRef.current;
    const previous = document.activeElement as HTMLElement | null;
    const first = node?.querySelector<HTMLElement>("[data-staff-onboarding-name]");
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
      const trigger = document.querySelector<HTMLElement>("[data-staff-add]");
      (trigger ?? previous)?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  function setField<K extends keyof StaffOnboardingDraft>(
    key: K,
    value: StaffOnboardingDraft[K],
  ) {
    setDraft((prev) => ({ ...prev, [key]: value }));
    setError("");
  }

  function goNext() {
    const invalid = validateOnboardingStep(step, draft, locations);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError("");
    setStep((current) => (current < 3 ? ((current + 1) as StaffOnboardingStep) : current));
  }

  function goBack() {
    setError("");
    setStep((current) => (current > 1 ? ((current - 1) as StaffOnboardingStep) : current));
  }

  function submit() {
    if (!canManage) {
      setError("沒有權限新增員工");
      return;
    }
    const invalid = validateOnboardingStep(3, draft, locations);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    try {
      const result = createStaffOnboardingFromDraft(organizationId, draft);
      onCreated(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "建立失敗");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center min-[720px]:items-center min-[720px]:px-5"
      data-staff-onboarding-root
    >
      <button
        type="button"
        className="absolute inset-0 bg-text/30"
        aria-label="關閉新增員工"
        onClick={onClose}
      />
      <div
        ref={dialogRef}
        data-staff-onboarding
        data-staff-onboarding-step={step}
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
            新增員工
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

        <ol
          className="flex shrink-0 gap-2 overflow-x-hidden px-5 pb-3"
          aria-label="新增員工步驟"
        >
          {STAFF_ONBOARDING_STEPS.map((entry) => {
            const current = step === entry.id;
            const done = step > entry.id;
            return (
              <li
                key={entry.id}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "flex min-w-0 flex-1 items-center gap-1.5 rounded-full px-2 py-1 text-[11px]",
                  current ? "bg-primary-light text-text" : "bg-[#F7F4F2] text-secondary-text",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                    current || done ? "bg-primary text-white" : "bg-[#E8E2DE] text-secondary-text",
                  )}
                >
                  {entry.id}
                </span>
                <span className="truncate">{entry.label}</span>
              </li>
            );
          })}
        </ol>

        <div className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-5 pb-3">
          {!canManage ? (
            <p className="rounded-2xl bg-[#F6EEEE] px-3 py-2 text-[13px] text-[#B07A4A]" role="alert">
              沒有權限新增員工
            </p>
          ) : null}

          {step === 1 ? (
            <div className="space-y-3">
              <label className="block text-[12px] text-secondary-text">
                員工姓名 *
                <input
                  data-staff-onboarding-name
                  className="mt-1 h-10 min-h-10 w-full rounded-xl border border-border px-3 text-[14px] text-text outline-none ring-primary/30 focus:ring-2"
                  value={draft.displayName}
                  onChange={(event) => setField("displayName", event.target.value)}
                  autoComplete="off"
                />
              </label>
              <p className="rounded-2xl bg-[#FAF7F5] px-3 py-2 text-[12px] leading-relaxed text-secondary-text">
                {STAFF_HAS_AUTH_ACCOUNT_CREATE
                  ? "將同時建立登入帳號。"
                  : "登入帳號功能尚未提供。這裡只建立員工資料，不會寄送邀請信或建立密碼。"}
              </p>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-4">
              <fieldset>
                <legend className="text-[12px] text-secondary-text">角色 *</legend>
                <div className="mt-2 grid grid-cols-1 gap-1.5 min-[480px]:grid-cols-2">
                  {STAFF_ONBOARDING_ROLES.map((role) => (
                    <label
                      key={role}
                      className={cn(
                        "flex min-h-10 items-center gap-2 rounded-xl border px-3 text-[13px]",
                        draft.role === role
                          ? "border-primary/50 bg-[#FBF4F3]"
                          : "border-border bg-surface",
                      )}
                    >
                      <input
                        type="radio"
                        name="staff-onboarding-role"
                        value={role}
                        checked={draft.role === role}
                        onChange={() => setField("role", role)}
                      />
                      <span>
                        {STAFF_ROLE_PRESENTATION[role]}
                        <span className="ml-1 text-[11px] text-secondary-text">{role}</span>
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>

              <fieldset>
                <legend className="text-[12px] text-secondary-text">分店 *（可複選）</legend>
                <div className="mt-2 space-y-1.5">
                  {locations.map((location) => {
                    const checked = draft.locationIds.includes(location.id);
                    return (
                      <label
                        key={location.id}
                        className={cn(
                          "flex min-h-10 items-center gap-2 rounded-xl border px-3 text-[13px]",
                          checked ? "border-primary/50 bg-[#FBF4F3]" : "border-border",
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setField(
                              "locationIds",
                              toggleOnboardingLocation(draft.locationIds, location.id),
                            )
                          }
                        />
                        {location.name}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-3">
              <fieldset>
                <legend className="text-[12px] text-secondary-text">初始班表</legend>
                <div className="mt-2 space-y-1.5">
                  <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-[13px]">
                    <input
                      type="radio"
                      name="staff-onboarding-schedule"
                      checked={draft.scheduleMode === "later"}
                      onChange={() => setField("scheduleMode", "later")}
                    />
                    稍後設定
                  </label>
                  <label className="flex min-h-10 items-center gap-2 rounded-xl border border-border px-3 text-[13px]">
                    <input
                      type="radio"
                      name="staff-onboarding-schedule"
                      checked={draft.scheduleMode === "basic"}
                      onChange={() => setField("scheduleMode", "basic")}
                    />
                    套用基本班表
                  </label>
                </div>
              </fieldset>

              {draft.scheduleMode === "basic" ? (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      className="h-8 min-h-8 rounded-full px-3 text-[12px]"
                      onClick={() =>
                        setField(
                          "hours",
                          applyOnboardingHoursPattern(draft.hours, "mon-fri"),
                        )
                      }
                    >
                      套用週一到週五
                    </Button>
                    <Button
                      variant="outline"
                      className="h-8 min-h-8 rounded-full px-3 text-[12px]"
                      onClick={() =>
                        setField(
                          "hours",
                          applyOnboardingHoursPattern(draft.hours, "mon-sat"),
                        )
                      }
                    >
                      套用週一到週六
                    </Button>
                  </div>
                  <ul className="space-y-1.5">
                    {draft.hours.map((day) => (
                      <li
                        key={day.dayOfWeek}
                        className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl border border-border/70 px-2.5 py-1.5"
                      >
                        <span className="w-10 text-[13px] font-medium text-text">
                          {staffOnboardingDayLabel(day.dayOfWeek)}
                        </span>
                        <label className="flex items-center gap-1 text-[12px] text-secondary-text">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-primary"
                            checked={day.isWorking}
                            onChange={(event) =>
                              setField(
                                "hours",
                                draft.hours.map((item) =>
                                  item.dayOfWeek === day.dayOfWeek
                                    ? { ...item, isWorking: event.target.checked }
                                    : item,
                                ),
                              )
                            }
                          />
                          上班
                        </label>
                        <label className="sr-only" htmlFor={`onboard-start-${day.dayOfWeek}`}>
                          {staffOnboardingDayLabel(day.dayOfWeek)}開始
                        </label>
                        <input
                          id={`onboard-start-${day.dayOfWeek}`}
                          type="time"
                          className="min-h-9 rounded-lg border border-border px-1.5 text-[12px] disabled:text-secondary-text"
                          value={day.startTime}
                          disabled={!day.isWorking}
                          onChange={(event) =>
                            setField(
                              "hours",
                              draft.hours.map((item) =>
                                item.dayOfWeek === day.dayOfWeek
                                  ? { ...item, startTime: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                        <span className="text-secondary-text">→</span>
                        <label className="sr-only" htmlFor={`onboard-end-${day.dayOfWeek}`}>
                          {staffOnboardingDayLabel(day.dayOfWeek)}結束
                        </label>
                        <input
                          id={`onboard-end-${day.dayOfWeek}`}
                          type="time"
                          className="min-h-9 rounded-lg border border-border px-1.5 text-[12px] disabled:text-secondary-text"
                          value={day.endTime}
                          disabled={!day.isWorking}
                          onChange={(event) =>
                            setField(
                              "hours",
                              draft.hours.map((item) =>
                                item.dayOfWeek === day.dayOfWeek
                                  ? { ...item, endTime: event.target.value }
                                  : item,
                              ),
                            )
                          }
                        />
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <p className="text-[12px] leading-relaxed text-secondary-text">
                  建立後可在員工詳情編輯固定班表、休息時間與休假。
                </p>
              )}
            </div>
          ) : null}

          {error ? (
            <p className="mt-3 text-[13px] text-[#B07A4A]" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <div className="shrink-0 border-t border-border px-5 py-3">
          <div className="flex gap-2">
            {step > 1 ? (
              <Button
                variant="outline"
                className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                disabled={busy}
                onClick={goBack}
              >
                上一步
              </Button>
            ) : (
              <Button
                variant="outline"
                className="h-10 min-h-10 rounded-full px-4 text-[13px]"
                disabled={busy}
                onClick={onClose}
              >
                取消
              </Button>
            )}
            {step < 3 ? (
              <Button
                className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
                disabled={!canManage || busy}
                onClick={goNext}
              >
                下一步
              </Button>
            ) : (
              <Button
                data-staff-onboarding-submit
                className="h-10 min-h-10 flex-1 rounded-full text-[13px]"
                disabled={!canManage || busy}
                onClick={submit}
              >
                {busy ? "建立中…" : "建立員工"}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
