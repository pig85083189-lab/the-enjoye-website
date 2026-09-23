"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";

interface StepFooterProps {
  onBack?: () => void;
  onNext?: () => void;
  onSkip?: () => void;
  nextLabel?: string;
  backLabel?: string;
  skipLabel?: string;
  nextDisabled?: boolean;
  hideBack?: boolean;
  extra?: ReactNode;
}

export function StepFooter({
  onBack,
  onNext,
  onSkip,
  nextLabel = "下一步",
  backLabel = "上一步",
  skipLabel = "略過此步驟",
  nextDisabled,
  hideBack,
  extra,
}: StepFooterProps) {
  return (
    <div className="mt-8 flex flex-col gap-3 border-t border-border pt-5">
      <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="order-2 sm:order-1">
          {!hideBack && onBack ? (
            <Button variant="ghost" onClick={onBack} className="min-h-11 px-2">
              {backLabel}
            </Button>
          ) : (
            <span />
          )}
        </div>
        <div className="order-1 flex w-full flex-col gap-2 sm:order-2 sm:w-auto sm:flex-row sm:items-center">
          {extra}
          {onSkip ? (
            <Button variant="ghost" onClick={onSkip} className="min-h-11">
              {skipLabel}
            </Button>
          ) : null}
          {onNext ? (
            <Button
              onClick={onNext}
              disabled={nextDisabled}
              className="min-h-12 w-full sm:min-w-[10rem]"
            >
              {nextLabel}
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
