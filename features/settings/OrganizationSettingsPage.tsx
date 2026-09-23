"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft, Building2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { updateOrganizationLocal } from "@/lib/tenant/organization-store";
import type { Organization } from "@/types/saas";

const fieldClass =
  "min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus:ring-2";
const labelClass = "mb-1.5 block text-sm text-secondary-text";

export function OrganizationSettingsPage() {
  const { organization } = useOrganization();
  const [formOrgId, setFormOrgId] = useState(organization.id);
  const [form, setForm] = useState<Organization>(organization);
  const [saved, setSaved] = useState(false);

  if (organization.id !== formOrgId) {
    setFormOrgId(organization.id);
    setForm(organization);
    setSaved(false);
  }

  function patch(partial: Partial<Organization>) {
    setForm((prev) => ({ ...prev, ...partial }));
    setSaved(false);
  }

  function handleSave() {
    updateOrganizationLocal(organization.id, {
      name: form.name.trim(),
      slug: form.slug.trim(),
      phone: form.phone?.trim(),
      email: form.email?.trim(),
      address: form.address?.trim(),
      timezone: form.timezone,
      currency: form.currency,
      locale: form.locale,
    });
    setSaved(true);
  }

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
        title="店家設定"
        description="Organization 基本資料（Local Prototype）"
      />

      <Card padding="lg" className="space-y-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary-light text-primary">
            <Building2 className="h-7 w-7" aria-hidden />
          </div>
          <div>
            <p className="text-sm text-secondary-text">Logo</p>
            <p className="text-[15px] text-text">Placeholder · 未來接 Storage</p>
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="org-name">
            店家名稱
          </label>
          <input
            id="org-name"
            className={fieldClass}
            value={form.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </div>

        <div>
          <label className={labelClass} htmlFor="org-slug">
            店家代稱 / slug
          </label>
          <input
            id="org-slug"
            className={fieldClass}
            value={form.slug}
            onChange={(e) => patch({ slug: e.target.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass} htmlFor="org-phone">
              電話
            </label>
            <input
              id="org-phone"
              className={fieldClass}
              value={form.phone ?? ""}
              onChange={(e) => patch({ phone: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="org-email">
              Email
            </label>
            <input
              id="org-email"
              type="email"
              className={fieldClass}
              value={form.email ?? ""}
              onChange={(e) => patch({ email: e.target.value })}
            />
          </div>
        </div>

        <div>
          <label className={labelClass} htmlFor="org-address">
            地址
          </label>
          <input
            id="org-address"
            className={fieldClass}
            value={form.address ?? ""}
            onChange={(e) => patch({ address: e.target.value })}
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass} htmlFor="org-tz">
              時區
            </label>
            <input
              id="org-tz"
              className={fieldClass}
              value={form.timezone}
              onChange={(e) => patch({ timezone: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="org-currency">
              幣別
            </label>
            <input
              id="org-currency"
              className={fieldClass}
              value={form.currency}
              onChange={(e) => patch({ currency: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="org-locale">
              語言
            </label>
            <input
              id="org-locale"
              className={fieldClass}
              value={form.locale}
              onChange={(e) => patch({ locale: e.target.value })}
            />
          </div>
        </div>

        <p className="text-xs text-secondary-text">
          預設：台灣 · Asia/Taipei · TWD · zh-TW · 僅存 localStorage，未接 Supabase
        </p>

        <div className="flex flex-wrap items-center gap-3">
          <Button className="min-h-11" onClick={handleSave}>
            儲存
          </Button>
          {saved ? <span className="text-sm text-success">已儲存</span> : null}
        </div>
      </Card>
    </div>
  );
}
