import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

interface CustomerEmptyStateProps {
  title: string;
  description?: string;
  actionHref?: string;
  actionLabel?: string;
  onAction?: () => void;
}

export function CustomerEmptyState({
  title,
  description,
  actionHref,
  actionLabel,
  onAction,
}: CustomerEmptyStateProps) {
  return (
    <Card padding="md" className="text-center">
      <p className="text-[15px] font-medium text-text">{title}</p>
      {description ? (
        <p className="mt-1 text-sm text-secondary-text">{description}</p>
      ) : null}
      {actionLabel && actionHref ? (
        <Link href={actionHref} className="mt-3 inline-flex">
          <Button variant="secondary" className="min-h-11">
            {actionLabel}
          </Button>
        </Link>
      ) : null}
      {actionLabel && onAction && !actionHref ? (
        <Button variant="secondary" className="mt-3 min-h-11" onClick={onAction}>
          {actionLabel}
        </Button>
      ) : null}
    </Card>
  );
}
