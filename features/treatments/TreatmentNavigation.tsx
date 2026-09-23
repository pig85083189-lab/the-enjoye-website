"use client";

import { Check, Minus } from "lucide-react";
import type { Appointment, Customer, TreatmentDraft } from "@/types";
import {
  TREATMENT_STEPS,
  isOptionalStep,
  type TreatmentStepId,
} from "@/types/treatment";
import { Badge } from "@/components/ui/Badge";
import { getStepCompletionState } from "@/lib/treatment-draft";
import { MEMBERSHIP_LABEL, cn } from "@/lib/utils";

interface TreatmentNavigationProps {
  customer: Customer;
  appointment: Appointment;
  draft: TreatmentDraft;
  currentStep: TreatmentStepId;
  onSelect: (step: TreatmentStepId) => void;
}

const membershipTone = {
  vip: "vip" as const,
  regular: "neutral" as const,
  new: "new" as const,
};

export function TreatmentNavigation({
  customer,
  appointment,
  draft,
  currentStep,
  onSelect,
}: TreatmentNavigationProps) {
  return (
    <aside className="rounded-2xl border border-border bg-surface p-5 shadow-[0_1px_2px_rgba(48,43,43,0.04)]">
      <div>
        <h2 className="text-lg font-semibold text-text">{customer.name}</h2>
        <div className="mt-2 flex flex-wrap gap-2">
          <Badge tone={membershipTone[customer.membership]}>
            {MEMBERSHIP_LABEL[customer.membership]}
          </Badge>
          {draft.mode === "QUICK" ? <Badge tone="primary">快速紀錄</Badge> : null}
        </div>
        <p className="mt-3 text-sm text-secondary-text">
          {appointment.serviceName}
          <span className="mx-1.5 text-border">·</span>
          {appointment.durationMinutes}分鐘
        </p>
        <p className="mt-1 text-sm text-secondary-text">美容師：{appointment.staffName}</p>
      </div>

      <nav className="mt-6 space-y-1" aria-label="療程步驟">
        {TREATMENT_STEPS.map((step, index) => {
          const state = getStepCompletionState(draft, step.id);
          const isCurrent = step.id === currentStep || state === "current";
          const optional = isOptionalStep(step.id);

          return (
            <button
              key={step.id}
              type="button"
              onClick={() => onSelect(step.id)}
              className={cn(
                "flex w-full min-h-11 items-center gap-3 rounded-2xl px-3 text-left text-sm transition-colors",
                isCurrent && "bg-primary-light text-primary",
                !isCurrent && "text-text hover:bg-[#FAF7F5]",
              )}
            >
              <span
                className={cn(
                  "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                  isCurrent && "bg-primary text-white",
                  !isCurrent && state === "complete" && "bg-[#E8F3EC] text-success",
                  !isCurrent && state === "skipped" && "bg-[#F3EEEC] text-secondary-text",
                  !isCurrent &&
                    state === "pending" &&
                    "bg-[#F3EEEC] text-secondary-text",
                )}
                aria-hidden
              >
                {isCurrent ? (
                  <span className="h-2 w-2 rounded-full bg-white" />
                ) : state === "complete" ? (
                  <Check className="h-3.5 w-3.5" />
                ) : state === "skipped" ? (
                  <Minus className="h-3.5 w-3.5" />
                ) : (
                  index + 1
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-medium">{step.label}</span>
                {optional ? (
                  <span className="text-[11px] font-normal text-secondary-text">
                    {state === "skipped" ? "已略過" : "選填"}
                  </span>
                ) : null}
              </span>
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
