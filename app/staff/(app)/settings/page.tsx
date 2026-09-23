"use client";

import Link from "next/link";
import { Building2, MapPin } from "lucide-react";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";

const links = [
  {
    href: "/staff/settings/organization",
    title: "店家設定",
    description: "名稱、聯絡方式、時區與語系",
    icon: Building2,
  },
  {
    href: "/staff/settings/locations",
    title: "分店設定",
    description: "主要分店與多分店 foundation",
    icon: MapPin,
  },
] as const;

export default function SettingsHubPage() {
  return (
    <div className="space-y-5">
      <PageHeader title="設定" description="店家與分店系統設定" />
      <div className="space-y-3">
        {links.map(({ href, title, description, icon: Icon }) => (
          <Link key={href} href={href} className="block">
            <Card padding="lg" className="transition-colors hover:border-primary/30">
              <div className="flex min-h-11 items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-primary-light text-primary">
                  <Icon className="h-5 w-5" aria-hidden />
                </div>
                <div>
                  <p className="text-[15px] font-semibold text-text">{title}</p>
                  <p className="mt-0.5 text-sm text-secondary-text">{description}</p>
                </div>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
