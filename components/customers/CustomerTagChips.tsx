import { Badge } from "@/components/ui/Badge";
import type { CustomerTag } from "@/types/customer";
import { cn } from "@/lib/utils";

const TONE_BY_ID: Record<string, "vip" | "new" | "warning" | "primary" | "neutral"> = {
  vip: "vip",
  new: "new",
  needs_follow_up: "warning",
  sensitive: "warning",
  breast: "primary",
  body: "primary",
  facial: "primary",
  birthday_month: "primary",
  regular: "neutral",
};

interface CustomerTagChipsProps {
  tags: CustomerTag[];
  className?: string;
  max?: number;
  nowrap?: boolean;
}

export function CustomerTagChips({ tags, className, max, nowrap = false }: CustomerTagChipsProps) {
  const shown = typeof max === "number" ? tags.slice(0, max) : tags;
  const rest = typeof max === "number" ? Math.max(0, tags.length - max) : 0;

  if (shown.length === 0) return null;

  return (
    <div className={cn("flex gap-1.5", nowrap ? "flex-nowrap overflow-hidden" : "flex-wrap", className)}>
      {shown.map((tag) => (
        <Badge key={tag.id} tone={TONE_BY_ID[tag.id] ?? "neutral"} className={nowrap ? "shrink-0" : undefined}>
          {tag.label}
        </Badge>
      ))}
      {rest > 0 ? <Badge tone="neutral" className={nowrap ? "shrink-0" : undefined}>+{rest}</Badge> : null}
    </div>
  );
}
