import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  accent?: "default" | "primary" | "warning" | "success";
  icon?: ReactNode;
}

const accentClasses = {
  default: "text-primary",
  primary: "text-[#C9797D]",
  warning: "text-[#B07A4A]",
  success: "text-[#4F7A5C]",
};

const iconToneClasses = {
  default: "text-primary/80",
  primary: "text-[#C9797D]/80",
  warning: "text-[#B07A4A]/80",
  success: "text-[#4F7A5C]/85",
};

export function StatCard({
  label,
  value,
  accent = "default",
  icon,
}: StatCardProps) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface px-3 py-2.5 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:px-3.5 sm:py-3">
      <div className="flex items-center gap-2">
        {icon ? (
          <span
            className={cn("shrink-0 opacity-90", iconToneClasses[accent])}
            aria-hidden
          >
            {icon}
          </span>
        ) : null}
        <p
          className={cn(
            "text-xl font-semibold tracking-tight tabular-nums sm:text-2xl",
            accentClasses[accent],
          )}
        >
          {value}
        </p>
      </div>
      <p className="mt-0.5 text-[11px] text-secondary-text sm:text-xs">{label}</p>
    </div>
  );
}
