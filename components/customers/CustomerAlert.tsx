import { Card } from "@/components/ui/Card";
import type { CustomerAlert as CustomerAlertType } from "@/types";
import { cn } from "@/lib/utils";

interface CustomerAlertProps {
  alerts: CustomerAlertType[];
}

const valueTone = {
  success: "text-[#4F7A5C]",
  warning: "text-[#B07A4A]",
  neutral: "text-text",
};

export function CustomerAlert({ alerts }: CustomerAlertProps) {
  return (
    <Card padding="lg">
      <h2 className="text-lg font-semibold text-text">重要提醒</h2>
      <ul className="mt-4 divide-y divide-border">
        {alerts.map((alert) => (
          <li key={alert.id} className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0">
            <span className="text-[15px] text-secondary-text">{alert.label}</span>
            <span className={cn("text-[15px] font-medium", valueTone[alert.tone ?? "neutral"])}>
              {alert.value}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
