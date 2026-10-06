"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CustomerEmptyState } from "@/features/customers/CustomerEmptyState";
import type { Customer360Snapshot } from "@/features/customers/use-customer-360";
import { formatTwd } from "@/lib/commerce/money";
import {
  CUSTOMER_360_TIMELINE_PREVIEW,
  hasServiceFocus,
  PACKAGE_STATUS_LABEL,
  type Customer360TabId,
  type Customer360WalletSection,
  type TimelineItemView,
} from "@/lib/customers/customer-360";
import { cn } from "@/lib/utils";
import {
  CHAT_PREF_LABEL,
  PRESSURE_LABEL,
  TEMPERATURE_LABEL,
} from "@/types/customer";
import type { Customer } from "@/types";

const CONDITION_DISPLAY_LIMIT = 5;

interface OverviewTabProps {
  customer: Customer;
  snapshot: Customer360Snapshot;
  onOpenTab: (tab: Customer360TabId, section?: Customer360WalletSection) => void;
}

export function OverviewTab({ customer, snapshot, onOpenTab }: OverviewTabProps) {
  const [showAllTimeline, setShowAllTimeline] = useState(false);
  const timeline = showAllTimeline ? snapshot.timeline : snapshot.timelinePreview;
  const prefs = customer.preferences;
  const hasPrefs = Boolean(
    prefs &&
      (prefs.preferredStaffName ||
        prefs.pressure ||
        prefs.chatPreference ||
        prefs.temperature ||
        prefs.scentPreference ||
        prefs.sensitiveProducts),
  );

  return (
    <div className="flex flex-col gap-4">
      {snapshot.attention.length > 0 ? (
        <Card padding="md" className="order-1 bg-[#FBF4F3]/70 min-[1200px]:hidden">
          <h3 className="text-[13px] font-medium text-secondary-text">重要提醒</h3>
          <ul className="mt-2 space-y-1.5">
            {snapshot.attention.slice(0, 5).map((note) => (
              <li key={note} className="flex gap-2 text-[14px] leading-snug text-text">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" aria-hidden />
                <span>{note}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <div className="order-2 min-[768px]:order-1">
        <ServiceFocusCard snapshot={snapshot} treatmentHref={snapshot.treatmentHref} />
      </div>

      {snapshot.nextAppointment ? (
        <div className="order-3 min-[768px]:order-2">
          <UpcomingAppointmentCard next={snapshot.nextAppointment} />
        </div>
      ) : null}

      <div className="order-4 min-[768px]:hidden">
        <Card padding="md" className="space-y-2">
          <p className="text-[13px] font-medium text-secondary-text">快速操作</p>
          <Link href={snapshot.treatmentHref} className="block">
            <Button fullWidth className="min-h-11">
              開始療程紀錄
            </Button>
          </Link>
          <Link href={snapshot.createHref} className="block">
            <Button fullWidth variant="secondary" className="min-h-11">
              新增預約
            </Button>
          </Link>
          <Button
            fullWidth
            variant="outline"
            className="min-h-11"
            onClick={() => onOpenTab("follow-ups")}
          >
            新增追蹤
          </Button>
        </Card>
      </div>

      <div className="order-6 max-[767px]:hidden min-[768px]:order-3">
        <FrequentServicesCard snapshot={snapshot} />
      </div>

      <div className="order-5 min-[768px]:order-4">
        <TimelineCard
          items={timeline}
          total={snapshot.timeline.length}
          expanded={showAllTimeline}
          onToggle={() => setShowAllTimeline((value) => !value)}
        />
      </div>

      <div className="order-6 min-[768px]:order-5">
        <FinancialSummary snapshot={snapshot} onOpenTab={onOpenTab} />
      </div>

      <div className="order-7 max-[767px]:hidden min-[768px]:order-6">
        <PreferencesCard prefs={prefs} hasPrefs={hasPrefs} />
      </div>

      <details className="order-7 rounded-2xl border border-border bg-surface min-[768px]:hidden">
        <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm font-medium text-text [&::-webkit-details-marker]:hidden">
          其他資訊
          <span className="text-xs font-normal text-secondary-text">展開</span>
        </summary>
        <div className="space-y-3 border-t border-border px-4 py-3">
          <FrequentServicesCard snapshot={snapshot} compact />
          <PreferencesCard prefs={prefs} hasPrefs={hasPrefs} compact />
        </div>
      </details>
    </div>
  );
}

function PreferencesCard({
  prefs,
  hasPrefs,
  compact = false,
}: {
  prefs: Customer["preferences"];
  hasPrefs: boolean;
  compact?: boolean;
}) {
  return (
    <Card padding={compact ? "sm" : "md"}>
      <h3 className="text-[15px] font-semibold text-text">客戶偏好</h3>
      {hasPrefs && prefs ? (
        <dl className="mt-3 grid gap-3 sm:grid-cols-2">
          {prefs.preferredStaffName ? (
            <PrefRow label="偏好美容師" value={prefs.preferredStaffName} />
          ) : null}
          {prefs.pressure ? (
            <PrefRow label="力道" value={PRESSURE_LABEL[prefs.pressure]} />
          ) : null}
          {prefs.chatPreference ? (
            <PrefRow label="聊天偏好" value={CHAT_PREF_LABEL[prefs.chatPreference]} />
          ) : null}
          {prefs.temperature ? (
            <PrefRow label="溫度" value={TEMPERATURE_LABEL[prefs.temperature]} />
          ) : null}
          {prefs.scentPreference ? (
            <PrefRow label="精油偏好" value={prefs.scentPreference} />
          ) : null}
          {prefs.sensitiveProducts ? (
            <PrefRow label="容易敏感產品" value={prefs.sensitiveProducts} />
          ) : null}
        </dl>
      ) : (
        <p className="mt-2 text-sm text-secondary-text">尚未建立偏好資料</p>
      )}
    </Card>
  );
}

function PrefRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-secondary-text">{label}</dt>
      <dd className="mt-0.5 text-[14px] text-text">{value}</dd>
    </div>
  );
}

function UpcomingAppointmentCard({
  next,
}: {
  next: NonNullable<Customer360Snapshot["nextAppointment"]>;
}) {
  return (
    <Card padding="md" data-customer-next-appointment>
      <h3 className="text-[15px] font-semibold text-text">下次預約</h3>
      <p className="mt-2 text-[14px] font-medium text-text">
        {next.serviceName ?? "預約"}
      </p>
      <p className="mt-0.5 text-sm text-secondary-text">
        {next.dateLabel} {next.timeLabel}
        {next.staffName ? ` · ${next.staffName}` : ""}
      </p>
    </Card>
  );
}

function ServiceFocusCard({
  snapshot,
  treatmentHref,
}: {
  snapshot: Customer360Snapshot;
  treatmentHref: string;
}) {
  const { focus } = snapshot;
  if (!hasServiceFocus(focus)) {
    return (
      <CustomerEmptyState
        title="尚無本次服務重點"
        description="完成療程紀錄或諮詢後，會顯示在這裡。"
        actionHref={treatmentHref}
        actionLabel="開始第一次療程"
      />
    );
  }

  const conditions = focus.conditionNotes.slice(0, CONDITION_DISPLAY_LIMIT);
  const hasLeft = conditions.length > 0 || focus.suggestions.length > 0;
  const hasNote = Boolean(focus.lastBeauticianNote);

  return (
    <Card padding="md" className="bg-[#FBF4F3]/55">
      <h3 className="text-[15px] font-semibold text-text">本次服務重點</h3>
      <div
        className={cn(
          "mt-4 grid gap-5",
          hasLeft && hasNote && "min-[768px]:grid-cols-2 min-[768px]:gap-6",
        )}
      >
        {hasLeft ? (
          <div className="space-y-5">
            {conditions.length > 0 ? (
              <section>
                <h4 className="text-[12px] font-medium tracking-wide text-secondary-text">
                  需要注意
                </h4>
                <ul className="mt-2 space-y-1.5">
                  {conditions.map((note) => (
                    <li key={note} className="flex gap-2 text-[14px] leading-snug text-text">
                      <span
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary"
                        aria-hidden
                      />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
            {focus.suggestions.length > 0 ? (
              <section>
                <h4 className="text-[12px] font-medium tracking-wide text-secondary-text">
                  本次建議
                </h4>
                <ul className="mt-2 space-y-1.5">
                  {focus.suggestions.map((note) => (
                    <li key={note} className="flex gap-2 text-[14px] leading-snug text-text">
                      <span
                        className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70"
                        aria-hidden
                      />
                      <span>{note}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
        {hasNote ? (
          <section className="rounded-2xl border border-border/80 bg-surface px-4 py-3">
            <h4 className="text-[12px] font-medium tracking-wide text-secondary-text">
              上次美容師紀錄
            </h4>
            <p className="mt-2 text-[14px] leading-relaxed text-text">
              {focus.lastBeauticianNote}
            </p>
          </section>
        ) : null}
      </div>
    </Card>
  );
}

function FrequentServicesCard({
  snapshot,
  compact = false,
}: {
  snapshot: Customer360Snapshot;
  compact?: boolean;
}) {
  if (snapshot.frequent.length === 0) {
    return (
      <CustomerEmptyState
        title="尚無常用服務"
        description="完成預約或療程後，會依真實使用次數計算。"
      />
    );
  }

  return (
    <Card padding={compact ? "sm" : "md"}>
      <h3 className="text-[15px] font-semibold text-text">常用服務</h3>
      <ul className="mt-2">
        {snapshot.frequent.map((row, index) => (
          <li
            key={row.serviceId}
            className={cn(
              "flex items-baseline justify-between gap-3 py-1.5",
              index > 0 && "border-t border-border/70",
            )}
          >
            <div className="min-w-0">
              <p className="truncate text-[14px] font-medium text-text">{row.serviceName}</p>
              <p className="mt-0.5 text-xs text-secondary-text">
                {row.usageCount} 次
                {row.durationMinutes ? ` · ${row.durationMinutes} 分鐘` : ""}
                {row.priceMinor != null ? ` · ${formatTwd(row.priceMinor)}` : ""}
              </p>
            </div>
            <p className="shrink-0 text-xs text-secondary-text">{row.lastUsedLabel}</p>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function TimelineCard({
  items,
  total,
  expanded,
  onToggle,
}: {
  items: TimelineItemView[];
  total: number;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (total === 0) {
    return (
      <CustomerEmptyState
        title="尚無最近動態"
        description="療程、追蹤、預約完成後會顯示在這裡。"
      />
    );
  }

  return (
    <Card padding="md">
      <h3 className="text-[15px] font-semibold text-text">最近動態</h3>
      <ol className="mt-2">
        {items.map((item, index) => (
          <li
            key={item.id}
            className={cn(
              "relative flex gap-2.5 py-2",
              index < items.length - 1 && "border-b border-border/60",
            )}
          >
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] leading-none text-secondary-text">
                {item.dateLabel}
                {item.timeLabel ? ` ${item.timeLabel}` : ""}
                <span className="mx-1 text-border">·</span>
                {item.typeLabel}
              </p>
              <p className="mt-1 truncate text-[14px] font-medium leading-snug text-text">
                {item.title}
              </p>
              {item.summary ? (
                <p className="mt-0.5 line-clamp-1 text-xs text-secondary-text">{item.summary}</p>
              ) : null}
              {item.href && item.ctaLabel ? (
                <Link
                  href={item.href}
                  className="mt-0.5 inline-flex min-h-8 items-center text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  {item.ctaLabel} →
                </Link>
              ) : null}
            </div>
          </li>
        ))}
      </ol>
      {total > CUSTOMER_360_TIMELINE_PREVIEW || expanded ? (
        <button
          type="button"
          onClick={onToggle}
          className="mt-2 flex min-h-11 w-full items-center justify-center text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {expanded ? "收合動態" : "查看全部動態"}
        </button>
      ) : null}
    </Card>
  );
}

function FinancialSummary({
  snapshot,
  onOpenTab,
}: {
  snapshot: Customer360Snapshot;
  onOpenTab: (tab: Customer360TabId, section?: Customer360WalletSection) => void;
}) {
  const pkg = snapshot.packagePreview[0];

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <Card padding="sm">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-text">套票</h3>
          <button
            type="button"
            onClick={() => onOpenTab("wallet", "packages")}
            className="text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            查看
          </button>
        </div>
        {pkg ? (
          <div className="mt-2 space-y-0.5">
            <p className="truncate text-[14px] text-text">{pkg.name}</p>
            <p className="text-sm tabular-nums text-text">
              剩餘 {pkg.usableBalance} / {pkg.sessionCountSnapshot} 堂
            </p>
            <p className="text-xs text-secondary-text">
              {PACKAGE_STATUS_LABEL[pkg.status] ?? pkg.status}
              {pkg.expiresAtLabel ? ` · ${pkg.expiresAtLabel}` : ""}
            </p>
          </div>
        ) : (
          <div className="mt-2">
            <p className="text-sm text-secondary-text">尚無套票</p>
            <button
              type="button"
              onClick={() => onOpenTab("wallet", "packages")}
              className="mt-1 min-h-8 text-xs font-medium text-primary"
            >
              查看套票
            </button>
          </div>
        )}
      </Card>

      <Card padding="sm">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-text">儲值</h3>
          <button
            type="button"
            onClick={() => onOpenTab("wallet", "stored-value")}
            className="text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            查看
          </button>
        </div>
        <p className="mt-2 text-lg font-semibold tabular-nums text-text">
          {formatTwd(snapshot.svBalance)}
        </p>
        <p className="mt-0.5 text-xs text-secondary-text">
          {snapshot.svBalance === 0 ? "目前沒有可用儲值" : "可用餘額"}
        </p>
      </Card>

      <Card padding="sm">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="text-[14px] font-semibold text-text">最近消費</h3>
          <button
            type="button"
            onClick={() => onOpenTab("transactions")}
            className="text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            查看
          </button>
        </div>
        {snapshot.recentTx.length > 0 ? (
          <ul className="mt-2 space-y-1.5">
            {snapshot.recentTx.map((tx) => (
              <li key={tx.id} className="flex items-baseline justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-text">{tx.itemSummary}</p>
                  <p className="text-xs text-secondary-text">{tx.dateLabel}</p>
                </div>
                <p className="shrink-0 text-[13px] tabular-nums text-text">
                  {formatTwd(tx.totalMinor)}
                </p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-secondary-text">尚無交易</p>
        )}
      </Card>
    </div>
  );
}
