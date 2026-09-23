import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeTone = "neutral" | "primary" | "success" | "warning" | "danger" | "vip" | "new";

interface BadgeProps {
  children: ReactNode;
  tone?: BadgeTone;
  className?: string;
}

const toneClasses: Record<BadgeTone, string> = {
  neutral: "bg-[#F3EEEC] text-secondary-text",
  primary: "bg-primary-light text-primary",
  success: "bg-[#E8F3EC] text-[#4F7A5C]",
  warning: "bg-[#F8EEE4] text-[#B07A4A]",
  danger: "bg-[#F7E8E8] text-[#B15B5B]",
  vip: "bg-[#F5E5E3] text-[#C9797D]",
  new: "bg-[#EEF2F7] text-[#6B7C93]",
};

export function Badge({ children, tone = "neutral", className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium tracking-wide",
        toneClasses[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
