"use client";

import { cn } from "@/lib/utils";

interface QuickSelectProps {
  options: readonly string[] | string[];
  value: string[];
  onChange: (next: string[]) => void;
  multiple?: boolean;
  className?: string;
}

export function QuickSelect({
  options,
  value,
  onChange,
  multiple = true,
  className,
}: QuickSelectProps) {
  function toggle(option: string) {
    if (multiple) {
      onChange(
        value.includes(option) ? value.filter((item) => item !== option) : [...value, option],
      );
      return;
    }
    onChange(value.includes(option) ? [] : [option]);
  }

  return (
    <div className={cn("flex flex-wrap gap-2", className)} role="group">
      {options.map((option) => {
        const selected = value.includes(option);
        return (
          <button
            key={option}
            type="button"
            aria-pressed={selected}
            onClick={() => toggle(option)}
            className={cn(
              "min-h-11 rounded-2xl border px-3.5 text-sm font-medium transition-colors",
              selected
                ? "border-primary bg-primary-light text-primary"
                : "border-border bg-surface text-secondary-text hover:border-primary/40 hover:text-text",
            )}
          >
            {option}
          </button>
        );
      })}
    </div>
  );
}
