"use client";

import { formatTwd } from "@/lib/commerce/money";
import type { FinanceTrendPoint } from "@/lib/finance/derived";
import { formatSharePercent } from "@/lib/finance/derived";

const COLLECTED = "#C9797D";
const EXPENSE = "#B8AEA6";

export type DonutSlice = {
  key: string;
  label: string;
  amountMinor: number;
  share: number;
};

const SLICE_COLORS = ["#C9797D", "#C4A06A", "#8A7E76", "#A98B8E", "#7A8B9A", "#C9C0B8"];

function colorFor(key: string, index: number): string {
  const named: Record<string, string> = {
    SALARY: "#C9797D",
    RENT: "#C4A06A",
    SUPPLIES: "#8A7E76",
    MARKETING: "#A98B8E",
    UTILITIES: "#7A8B9A",
    PRODUCTS: "#C4B08A",
    SERVICE: "#C9797D",
    PACKAGE_SALE: "#C4A06A",
    PRODUCT: "#8A7E76",
    OTHER: "#C9C0B8",
    MAINTENANCE: "#8A7E76",
    FEES: "#A98B8E",
    EQUIPMENT: "#7A8B9A",
    TAX: "#C4A06A",
  };
  return named[key] ?? SLICE_COLORS[index % SLICE_COLORS.length];
}

function smoothPath(points: Array<{ x: number; y: number }>): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
  let d = `M ${points[0].x} ${points[0].y}`;
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i === 0 ? 0 : i - 1];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
  }
  return d;
}

export function FinanceTrendChart({
  points,
  summary,
  includeExpense = true,
}: {
  points: FinanceTrendPoint[];
  summary: string;
  includeExpense?: boolean;
}) {
  const width = 560;
  const height = 220;
  const padX = 28;
  const padY = 18;
  const max = Math.max(
    0,
    ...points.map((point) =>
      Math.max(point.collectedMinor, includeExpense ? point.expenseMinor : 0),
    ),
  );
  const innerW = width - padX * 2;
  const innerH = height - padY * 2 - 18;
  const toX = (index: number) =>
    padX + (points.length <= 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const toY = (value: number) =>
    padY + innerH - (max > 0 ? (value / max) * innerH : 0);
  const collected = points.map((point, index) => ({
    x: toX(index),
    y: toY(point.collectedMinor),
  }));
  const expenses = points.map((point, index) => ({
    x: toX(index),
    y: toY(point.expenseMinor),
  }));
  const collectedLine = smoothPath(collected);
  const expenseLine = smoothPath(expenses);
  const area =
    collected.length > 0
      ? `${collectedLine} L ${collected[collected.length - 1].x} ${padY + innerH} L ${collected[0].x} ${padY + innerH} Z`
      : "";
  const hasData = max > 0;

  return (
    <div className="min-w-0">
      <p className="sr-only">{summary}</p>
      {!hasData ? (
        <p className="py-12 text-center text-sm text-secondary-text">此期間尚無收支資料</p>
      ) : (
        <svg
          role="img"
          aria-label={summary}
          viewBox={`0 0 ${width} ${height}`}
          className="h-52 w-full"
        >
          <path d={area} fill="rgba(201,121,125,0.12)" />
          <path d={collectedLine} fill="none" stroke={COLLECTED} strokeWidth="2.25" />
          {includeExpense ? (
            <path d={expenseLine} fill="none" stroke={EXPENSE} strokeWidth="2" />
          ) : null}
          {points.map((point, index) => {
            const show =
              points.length <= 8 ||
              index === 0 ||
              index === points.length - 1 ||
              index % Math.ceil(points.length / 6) === 0;
            return show ? (
              <text
                key={point.ymd}
                x={toX(index)}
                y={height - 2}
                textAnchor="middle"
                className="fill-[#8b8181] text-[10px]"
              >
                {point.label}
              </text>
            ) : null;
          })}
        </svg>
      )}
    </div>
  );
}

export function FinanceDonut({
  total,
  totalLabel,
  rows,
}: {
  total: number;
  totalLabel: string;
  rows: DonutSlice[];
}) {
  const stops = rows
    .filter((row) => row.amountMinor > 0)
    .reduce<{ parts: string[]; cursor: number }>(
      (acc, row, index) => {
        const start = total > 0 ? (acc.cursor / total) * 360 : 0;
        const next = acc.cursor + row.amountMinor;
        const end = total > 0 ? (next / total) * 360 : 0;
        return {
          parts: [...acc.parts, `${colorFor(row.key, index)} ${start}deg ${end}deg`],
          cursor: next,
        };
      },
      { parts: [], cursor: 0 },
    ).parts;
  const summary = rows.map((row) => `${row.label} ${formatTwd(row.amountMinor)}`).join("，");

  return (
    <div className="flex min-w-0 flex-col items-center gap-6 min-[820px]:flex-row min-[820px]:items-start">
      <div
        role="img"
        aria-label={`${totalLabel} ${formatTwd(total)}。${summary}`}
        className="relative h-[168px] w-[168px] shrink-0"
      >
        <div
          className="h-full w-full rounded-full"
          style={{
            background:
              total > 0 && stops.length > 0
                ? `conic-gradient(${stops.join(", ")})`
                : "var(--border)",
          }}
        />
        <div className="absolute inset-[28px] flex flex-col items-center justify-center rounded-full bg-surface text-center">
          <p className="text-[15px] font-semibold tabular-nums text-text">{formatTwd(total)}</p>
          <p className="text-[11px] text-secondary-text">{totalLabel}</p>
        </div>
      </div>
      <ul className="w-full min-w-0 flex-1 space-y-2.5 min-[820px]:pt-3">
        {rows.length === 0 ? (
          <li className="text-sm text-secondary-text">此期間尚無分類資料</li>
        ) : (
          rows.map((row, index) => (
            <li key={row.key} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span
                  aria-hidden
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: colorFor(row.key, index) }}
                />
                <span className="truncate text-text">{row.label}</span>
              </span>
              <span className="shrink-0 tabular-nums text-secondary-text">
                {formatTwd(row.amountMinor)} {formatSharePercent(row.share)}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
