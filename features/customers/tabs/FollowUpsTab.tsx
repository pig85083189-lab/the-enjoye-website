"use client";

import { useMemo, useSyncExternalStore } from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { formatHm, formatYmd } from "@/lib/appointments/domain";
import {
  FOLLOW_UP_STATUS_LABEL,
  FOLLOW_UP_TYPE_LABEL,
} from "@/lib/follow-ups/domain";
import {
  getFollowUpRevision,
  listFollowUpTasksForCustomer,
  subscribeFollowUps,
  buildRebookHref,
} from "@/lib/follow-ups/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

interface FollowUpsTabProps {
  customerId: string;
}

export function FollowUpsTab({ customerId }: FollowUpsTabProps) {
  const { organization } = useOrganization();
  const rev = useSyncExternalStore(
    subscribeFollowUps,
    getFollowUpRevision,
    () => "",
  );

  const tasks = useMemo(() => {
    void rev;
    return listFollowUpTasksForCustomer(organization.id, customerId);
  }, [organization.id, customerId, rev]);

  const open = tasks.filter((t) => t.status === "OPEN");
  const completed = tasks.filter((t) => t.status === "COMPLETED");

  if (tasks.length === 0) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">尚無追蹤紀錄</p>
        <p className="mt-2 text-sm text-secondary-text">
          完成療程並設定下次追蹤後，會顯示在此。
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text">進行中</h2>
        {open.length === 0 ? (
          <p className="text-sm text-secondary-text">目前沒有待追蹤項目</p>
        ) : (
          open.map((task) => (
            <FollowUpCard key={task.id} task={task} />
          ))
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-sm font-semibold text-text">已完成</h2>
        {completed.length === 0 ? (
          <p className="text-sm text-secondary-text">尚無已完成追蹤</p>
        ) : (
          completed.map((task) => (
            <FollowUpCard key={task.id} task={task} />
          ))
        )}
      </section>
      <Link href="/staff/follow-ups">
        <Button variant="outline" className="min-h-11">
          前往追蹤工作台
        </Button>
      </Link>
    </div>
  );
}

function FollowUpCard({
  task,
}: {
  task: ReturnType<typeof listFollowUpTasksForCustomer>[number];
}) {
  const due = (() => {
    try {
      const d = new Date(task.dueAt);
      return `${formatYmd(d)} ${formatHm(d)}`;
    } catch {
      return task.dueAt;
    }
  })();

  return (
    <Card padding="md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-text">
            {FOLLOW_UP_TYPE_LABEL[task.type]}
          </p>
          <p className="mt-1 text-sm text-secondary-text">到期：{due}</p>
          {task.context.serviceName ? (
            <p className="mt-1 text-sm text-secondary-text">
              {task.context.serviceName}
            </p>
          ) : null}
          {(task.note || task.completionNote) && (
            <p className="mt-2 text-[15px] text-text">
              {task.completionNote || task.note}
            </p>
          )}
          {task.context.followUpTags.length > 0 ? (
            <p className="mt-1 text-xs text-secondary-text">
              {task.context.followUpTags.join("、")}
            </p>
          ) : null}
        </div>
        <span
          className={cn(
            "rounded-full px-2.5 py-1 text-xs font-medium",
            task.status === "OPEN"
              ? "bg-amber-50 text-amber-800"
              : "bg-emerald-50 text-emerald-800",
          )}
        >
          {FOLLOW_UP_STATUS_LABEL[task.status]}
        </span>
      </div>
      {task.status === "OPEN" ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href={buildRebookHref(task)}>
            <Button variant="secondary" className="min-h-11">
              再次預約
            </Button>
          </Link>
          <Link href="/staff/follow-ups">
            <Button variant="outline" className="min-h-11">
              管理追蹤
            </Button>
          </Link>
        </div>
      ) : null}
    </Card>
  );
}
