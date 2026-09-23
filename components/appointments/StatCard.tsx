import { cn } from "@/lib/utils";

interface StatCardProps {
  label: string;
  value: number | string;
  accent?: "default" | "primary" | "warning" | "success";
}

const accentClasses = {
  default: "text-text",
  primary: "text-primary",
  warning: "text-[#B07A4A]",
  success: "text-[#4F7A5C]",
};

export function StatCard({ label, value, accent = "default" }: StatCardProps) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface px-3.5 py-3 shadow-[0_1px_2px_rgba(48,43,43,0.04)]">
      <p className={cn("text-2xl font-semibold tracking-tight tabular-nums", accentClasses[accent])}>
        {value}
      </p>
      <p className="mt-0.5 text-xs text-secondary-text sm:text-sm">{label}</p>
    </div>
  );
}
