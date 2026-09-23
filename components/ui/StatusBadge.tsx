import { Badge } from "@/components/ui/Badge";
import type { AppointmentStatus } from "@/types";
import { STATUS_LABEL } from "@/lib/utils";

const statusTone: Record<AppointmentStatus, "warning" | "primary" | "success"> = {
  pending: "warning",
  in_progress: "primary",
  completed: "success",
};

interface StatusBadgeProps {
  status: AppointmentStatus;
}

export function StatusBadge({ status }: StatusBadgeProps) {
  return <Badge tone={statusTone[status]}>{STATUS_LABEL[status]}</Badge>;
}
