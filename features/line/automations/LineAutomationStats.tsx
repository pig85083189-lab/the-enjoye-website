import {
  LINE_AUTOMATION_EMPTY_STAT_CAPTION,
  LINE_AUTOMATION_STATS_EMPTY_HINT,
} from "@/lib/line/automations/copy";
import { formatLineAutomationStat } from "@/lib/line/automations/draft";
import type { LineAutomationStats } from "@/lib/line/automations/types";
import { Check, Clock3, Send, Users } from "lucide-react";

const METRICS = [
  { key: "sentThisMonth", label: "已發送訊息", icon: Send },
  { key: "plannedThisMonth", label: "預計發送", icon: Users },
  { key: "successRate", label: "發送成功率", icon: Check },
  { key: "pendingTasks", label: "待發送任務", icon: Clock3 },
] as const;

export function LineAutomationMonthlyStats({
  stats,
}: {
  stats: LineAutomationStats;
}) {
  return (
    <section
      data-line-automation-stats
      className="rounded-[20px] border border-border bg-[#FFFCFB] p-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:p-5"
    >
      <h2 className="text-[15px] font-semibold text-text">本月發送總覽</h2>
      <div className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        {METRICS.map((metric) => {
          const Icon = metric.icon;
          const value = stats[metric.key];
          return (
            <div
              key={metric.key}
              className="rounded-2xl bg-white px-4 py-3 shadow-[0_1px_2px_rgba(48,43,43,0.03)]"
            >
              <div className="flex items-center gap-2 text-secondary-text">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-primary-light text-primary">
                  <Icon className="h-4 w-4" aria-hidden />
                </span>
                <p className="text-[12px]">{metric.label}</p>
              </div>
              <p className="mt-2 text-[28px] font-semibold leading-none text-text">
                {formatLineAutomationStat(value)}
              </p>
              <p className="mt-1 text-[11px] text-secondary-text">
                {LINE_AUTOMATION_EMPTY_STAT_CAPTION}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-3 text-[12px] leading-relaxed text-secondary-text">
        {LINE_AUTOMATION_STATS_EMPTY_HINT}
      </p>
    </section>
  );
}

export function LineAutomationCardMetrics({
  plannedCount = null,
  bindCount = null,
  consentCount = null,
}: {
  plannedCount?: number | null;
  bindCount?: number | null;
  consentCount?: number | null;
}) {
  return (
    <div className="flex shrink-0 gap-5 text-right" data-line-automation-card-metrics>
      <div>
        <p className="text-[11px] text-secondary-text">已驗證綁定</p>
        <p className="text-[22px] font-semibold leading-none text-text" data-line-automation-bind-count>
          {formatLineAutomationStat(bindCount)}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-secondary-text">已同意提醒</p>
        <p className="text-[22px] font-semibold leading-none text-text" data-line-automation-consent-count>
          {formatLineAutomationStat(consentCount)}
        </p>
      </div>
      <div>
        <p className="text-[11px] text-secondary-text">預定提醒</p>
        <p className="text-[22px] font-semibold leading-none text-text" data-line-automation-planned-count>
          {formatLineAutomationStat(plannedCount)}
        </p>
      </div>
    </div>
  );
}
