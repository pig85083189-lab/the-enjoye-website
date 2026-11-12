import { Cake, CalendarDays, MessageCircle, PartyPopper, Percent } from "lucide-react";
import type { LineAutomationDefinition } from "@/lib/line/automations/types";

const ICONS = {
  calendar: CalendarDays,
  cake: Cake,
  party: PartyPopper,
  message: MessageCircle,
  percent: Percent,
} as const;

export function LineAutomationIcon({
  icon,
  className = "h-5 w-5",
}: {
  icon: LineAutomationDefinition["icon"];
  className?: string;
}) {
  const Icon = ICONS[icon];
  return <Icon className={className} aria-hidden />;
}
