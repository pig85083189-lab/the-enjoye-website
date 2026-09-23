"use client";

import { useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  combineLocalDateTime,
  formatHm,
  formatYmd,
} from "@/lib/appointments/domain";
import {
  DAY_OF_WEEK_LABEL,
  type DayOfWeek,
} from "@/lib/staff-schedule/domain";
import {
  createBreak,
  createTimeOff,
  deleteBreak,
  deleteTimeOff,
  getStaffScheduleRevision,
  listBookableStaff,
  listBreaks,
  listTimeOff,
  listWorkingHours,
  subscribeStaffSchedule,
  upsertWorkingHours,
} from "@/lib/staff-schedule/store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";

const DAYS: DayOfWeek[] = [1, 2, 3, 4, 5, 6, 0];

export function StaffSchedulePage() {
  const { organization, currentLocation, locations } = useOrganization();
  const revision = useSyncExternalStore(
    subscribeStaffSchedule,
    getStaffScheduleRevision,
    () => "",
  );
  void revision;

  const locationId = currentLocation?.id ?? locations[0]?.id ?? "";
  const staff = listBookableStaff(organization.id, locationId);
  const [staffId, setStaffId] = useState(staff[0]?.userId ?? "");
  const selected = staff.find((s) => s.userId === staffId) ?? staff[0];

  const hours = selected
    ? listWorkingHours(organization.id, {
        locationId,
        staffId: selected.userId,
      })
    : [];

  const breaks = selected
    ? listBreaks(organization.id, { locationId, staffId: selected.userId })
    : [];
  const timeOffs = selected
    ? listTimeOff(organization.id, { locationId, staffId: selected.userId })
    : [];

  const [breakDate, setBreakDate] = useState(formatYmd(new Date()));
  const [breakStart, setBreakStart] = useState("12:00");
  const [breakEnd, setBreakEnd] = useState("13:00");
  const [breakLabel, setBreakLabel] = useState("午休");
  const [offDate, setOffDate] = useState(formatYmd(new Date()));
  const [offStart, setOffStart] = useState("09:00");
  const [offEnd, setOffEnd] = useState("21:00");
  const [offReason, setOffReason] = useState("");
  const [error, setError] = useState("");

  if (!selected) {
    return (
      <Card padding="lg" className="text-sm text-secondary-text">
        此分店尚無可排班員工。
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-text">員工排班</h1>
        <p className="mt-1 text-sm text-secondary-text">
          {currentLocation?.name ?? "分店"} · 工作時間、休息與休假（原型）
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="tablist" aria-label="選擇員工">
        {staff.map((s) => (
          <button
            key={s.userId}
            type="button"
            role="tab"
            aria-selected={s.userId === selected.userId}
            className={`min-h-11 rounded-2xl px-4 text-sm ${
              s.userId === selected.userId
                ? "bg-primary text-white"
                : "bg-surface text-text"
            }`}
            onClick={() => setStaffId(s.userId)}
          >
            {s.displayName}
          </button>
        ))}
      </div>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-lg font-medium text-text">
          {selected.displayName} · 每週工時
        </h2>
        <ul className="space-y-2">
          {DAYS.map((dow) => {
            const row = hours.find((h) => h.dayOfWeek === dow);
            const isWorking = row?.isWorking ?? dow !== 0;
            const start = row?.startTime ?? "10:00";
            const end = row?.endTime ?? "19:00";
            return (
              <li
                key={dow}
                className="flex flex-wrap items-center gap-2 border-b border-border/60 py-2 last:border-0"
              >
                <span className="w-8 text-sm font-medium text-text">
                  {DAY_OF_WEEK_LABEL[dow]}
                </span>
                <label className="flex min-h-11 items-center gap-2 text-sm text-secondary-text">
                  <input
                    type="checkbox"
                    checked={isWorking}
                    onChange={(e) => {
                      try {
                        upsertWorkingHours(organization.id, {
                          locationId,
                          staffId: selected.userId,
                          dayOfWeek: dow,
                          startTime: start,
                          endTime: end,
                          isWorking: e.target.checked,
                        });
                        setError("");
                      } catch (err) {
                        setError(err instanceof Error ? err.message : "無法更新");
                      }
                    }}
                  />
                  上班
                </label>
                <input
                  type="time"
                  className="min-h-11 rounded-2xl border border-border px-2 text-sm"
                  value={start}
                  disabled={!isWorking}
                  onChange={(e) => {
                    try {
                      upsertWorkingHours(organization.id, {
                        locationId,
                        staffId: selected.userId,
                        dayOfWeek: dow,
                        startTime: e.target.value,
                        endTime: end,
                        isWorking,
                      });
                      setError("");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "無法更新");
                    }
                  }}
                />
                <span className="text-secondary-text">–</span>
                <input
                  type="time"
                  className="min-h-11 rounded-2xl border border-border px-2 text-sm"
                  value={end}
                  disabled={!isWorking}
                  onChange={(e) => {
                    try {
                      upsertWorkingHours(organization.id, {
                        locationId,
                        staffId: selected.userId,
                        dayOfWeek: dow,
                        startTime: start,
                        endTime: e.target.value,
                        isWorking,
                      });
                      setError("");
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "無法更新");
                    }
                  }}
                />
              </li>
            );
          })}
        </ul>
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-lg font-medium text-text">新增休息時段</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="text-sm text-secondary-text">
            日期
            <input
              type="date"
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={breakDate}
              onChange={(e) => setBreakDate(e.target.value)}
            />
          </label>
          <label className="text-sm text-secondary-text">
            開始
            <input
              type="time"
              step={1800}
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={breakStart}
              onChange={(e) => setBreakStart(e.target.value)}
            />
          </label>
          <label className="text-sm text-secondary-text">
            結束
            <input
              type="time"
              step={1800}
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={breakEnd}
              onChange={(e) => setBreakEnd(e.target.value)}
            />
          </label>
          <label className="text-sm text-secondary-text">
            標籤
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={breakLabel}
              onChange={(e) => setBreakLabel(e.target.value)}
            />
          </label>
        </div>
        <Button
          className="min-h-11"
          onClick={() => {
            try {
              createBreak(organization.id, {
                locationId,
                staffId: selected.userId,
                startAt: combineLocalDateTime(breakDate, breakStart).toISOString(),
                endAt: combineLocalDateTime(breakDate, breakEnd).toISOString(),
                label: breakLabel || "休息",
              });
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "無法新增休息");
            }
          }}
        >
          新增休息
        </Button>
        <ul className="space-y-2">
          {breaks.length === 0 ? (
            <li className="text-sm text-secondary-text">尚無休息時段</li>
          ) : (
            breaks.map((br) => (
              <li
                key={br.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-primary-light/30 px-3 py-2 text-sm"
              >
                <span>
                  {br.label ?? "休息"} · {formatYmd(new Date(br.startAt))}{" "}
                  {formatHm(new Date(br.startAt))}–{formatHm(new Date(br.endAt))}
                </span>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    try {
                      deleteBreak(organization.id, br.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "無法刪除");
                    }
                  }}
                >
                  刪除
                </Button>
              </li>
            ))
          )}
        </ul>
      </Card>

      <Card padding="lg" className="space-y-3">
        <h2 className="text-lg font-medium text-text">新增休假時段</h2>
        <div className="grid gap-2 sm:grid-cols-4">
          <label className="text-sm text-secondary-text">
            日期
            <input
              type="date"
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={offDate}
              onChange={(e) => setOffDate(e.target.value)}
            />
          </label>
          <label className="text-sm text-secondary-text">
            開始
            <input
              type="time"
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={offStart}
              onChange={(e) => setOffStart(e.target.value)}
            />
          </label>
          <label className="text-sm text-secondary-text">
            結束
            <input
              type="time"
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={offEnd}
              onChange={(e) => setOffEnd(e.target.value)}
            />
          </label>
          <label className="text-sm text-secondary-text">
            原因
            <input
              className="mt-1 min-h-11 w-full rounded-2xl border border-border px-2"
              value={offReason}
              onChange={(e) => setOffReason(e.target.value)}
              placeholder="選填"
            />
          </label>
        </div>
        <Button
          className="min-h-11"
          onClick={() => {
            try {
              createTimeOff(organization.id, {
                locationId,
                staffId: selected.userId,
                startAt: combineLocalDateTime(offDate, offStart).toISOString(),
                endAt: combineLocalDateTime(offDate, offEnd).toISOString(),
                reason: offReason || undefined,
                status: "APPROVED",
              });
              setError("");
            } catch (err) {
              setError(err instanceof Error ? err.message : "無法新增休假");
            }
          }}
        >
          新增休假
        </Button>
        <ul className="space-y-2">
          {timeOffs.length === 0 ? (
            <li className="text-sm text-secondary-text">尚無休假紀錄</li>
          ) : (
            timeOffs.map((off) => (
              <li
                key={off.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-secondary-text/5 px-3 py-2 text-sm"
              >
                <span>
                  {formatYmd(new Date(off.startAt))}{" "}
                  {formatHm(new Date(off.startAt))}–{formatHm(new Date(off.endAt))}
                  {off.reason ? ` · ${off.reason}` : ""}
                  <span className="ml-2 text-xs text-secondary-text">{off.status}</span>
                </span>
                <Button
                  variant="ghost"
                  className="min-h-11"
                  onClick={() => {
                    try {
                      deleteTimeOff(organization.id, off.id);
                    } catch (err) {
                      setError(err instanceof Error ? err.message : "無法刪除");
                    }
                  }}
                >
                  刪除
                </Button>
              </li>
            ))
          )}
        </ul>
      </Card>

      {error ? (
        <p className="text-sm text-[#B07A4A]" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
