"use client";

import { useMemo, useState } from "react";
import { Card } from "@/components/ui/Card";
import { localCustomerPhotoRepository } from "@/lib/repositories/local-photo-repository";
import { photoPlaceholderDataUrl } from "@/lib/photo-placeholder";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";
import type { CustomerPhotoKind } from "@/types/customer";

const FILTERS: Array<{ id: "all" | CustomerPhotoKind; label: string }> = [
  { id: "all", label: "全部" },
  { id: "before", label: "療程前" },
  { id: "after", label: "療程後" },
  { id: "follow_up", label: "追蹤照" },
];

const KIND_LABEL: Record<CustomerPhotoKind, string> = {
  before: "Before",
  after: "After",
  follow_up: "追蹤",
  other: "其他",
};

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

interface PhotosTabProps {
  customerId: string;
}

export function PhotosTab({ customerId }: PhotosTabProps) {
  const { organization } = useOrganization();
  const [filter, setFilter] = useState<"all" | CustomerPhotoKind>("all");
  const photos = localCustomerPhotoRepository.listByCustomer({
    organizationId: organization.id,
    customerId,
  });

  const filtered = useMemo(
    () => (filter === "all" ? photos : photos.filter((p) => p.kind === filter)),
    [photos, filter],
  );

  const groups = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const photo of filtered) {
      const key = formatDate(photo.takenAt);
      const list = map.get(key) ?? [];
      list.push(photo);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [filtered]);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setFilter(item.id)}
            className={cn(
              "min-h-11 shrink-0 rounded-2xl px-4 text-sm font-medium",
              filter === item.id
                ? "bg-primary text-white"
                : "bg-primary-light/60 text-text",
            )}
          >
            {item.label}
          </button>
        ))}
      </div>

      {groups.length === 0 ? (
        <Card padding="lg">
          <p className="text-[15px] text-secondary-text">尚無照片（Prototype 使用示意圖）</p>
        </Card>
      ) : (
        groups.map(([date, items]) => (
          <div key={date} className="space-y-3">
            <h3 className="text-sm font-medium text-secondary-text">{date}</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              {items.map((photo) => (
                <Card key={photo.id} padding="sm" className="overflow-hidden">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={photoPlaceholderDataUrl(photo.kind)}
                    alt={`${KIND_LABEL[photo.kind]} placeholder`}
                    className="aspect-[4/3] w-full rounded-xl object-cover"
                  />
                  <div className="mt-2 px-1 pb-1">
                    <p className="text-sm font-medium text-text">
                      {KIND_LABEL[photo.kind]}
                      {photo.serviceName ? ` · ${photo.serviceName}` : ""}
                    </p>
                    <p className="text-xs text-secondary-text">
                      {photo.staffName ?? "—"} · {formatDate(photo.takenAt)}
                    </p>
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
