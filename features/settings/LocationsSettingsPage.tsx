"use client";

import Link from "next/link";
import { ArrowLeft, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";

export function LocationsSettingsPage() {
  const { organization, locations, currentLocation, switchLocation } = useOrganization();

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <Link
        href="/staff/more"
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text"
      >
        <ArrowLeft className="h-4 w-4" />
        更多
      </Link>

      <PageHeader
        title="分店設定"
        description={`${organization.name} · Location foundation（Prototype）`}
      />

      <p className="text-sm text-secondary-text">
        架構支援未來多分店（例如台中／台北／高雄）。本階段僅展示現有分店，不做完整 CRUD。
      </p>

      <div className="space-y-3">
        {locations.map((loc) => {
          const isCurrent = currentLocation?.id === loc.id;
          return (
            <Card
              key={loc.id}
              padding="lg"
              className={cn(isCurrent && "border-primary/40")}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-primary">
                  <MapPin className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-text">{loc.name}</h2>
                    {loc.isPrimary ? (
                      <span className="rounded-full bg-primary-light px-2.5 py-0.5 text-xs font-medium text-primary">
                        主要分店
                      </span>
                    ) : null}
                    <span
                      className={cn(
                        "rounded-full px-2.5 py-0.5 text-xs font-medium",
                        loc.isActive
                          ? "bg-[#E8F3EC] text-success"
                          : "bg-primary-light/60 text-secondary-text",
                      )}
                    >
                      {loc.isActive ? "啟用" : "停用"}
                    </span>
                  </div>
                  {loc.code ? (
                    <p className="mt-1 text-sm text-secondary-text">代碼：{loc.code}</p>
                  ) : null}
                  <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
                    <div>
                      <dt className="text-secondary-text">電話</dt>
                      <dd className="font-medium text-text">{loc.phone || "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-secondary-text">時區</dt>
                      <dd className="font-medium text-text">{loc.timezone || "—"}</dd>
                    </div>
                    <div className="sm:col-span-2">
                      <dt className="text-secondary-text">地址</dt>
                      <dd className="font-medium text-text">{loc.address || "—"}</dd>
                    </div>
                  </dl>
                  {!isCurrent && loc.isActive ? (
                    <Button
                      variant="outline"
                      className="mt-3 min-h-11"
                      onClick={() => switchLocation(loc.id)}
                    >
                      設為目前分店（Prototype）
                    </Button>
                  ) : null}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card padding="lg" className="border-dashed">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-[15px] font-medium text-text">新增分店</p>
            <p className="mt-1 text-sm text-secondary-text">
              Demo UI — 完整 CRUD 將於後續 Phase 實作
            </p>
          </div>
          <Button variant="secondary" className="min-h-11" disabled title="尚未開放">
            <Plus className="h-4 w-4" aria-hidden />
            新增分店
          </Button>
        </div>
      </Card>
    </div>
  );
}
