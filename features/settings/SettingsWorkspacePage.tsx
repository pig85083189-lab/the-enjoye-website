"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { OrgLocationSwitcher } from "@/components/navigation/OrgLocationSwitcher";
import { canShowLineSettings } from "@/lib/line/line-visibility";
import { updateOrganizationLocal } from "@/lib/tenant/organization-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { PLATFORM_NAME } from "@/lib/tenant/constants";
import {
  SETTINGS_BRAND_TAGLINE,
  SETTINGS_CATEGORY_OPTIONS,
  SETTINGS_WORKSPACE_GAP_PX,
  canUploadOrganizationLogo,
  formatOrganizationCurrencyLabel,
  formatOrganizationLocaleLabel,
  formatOrganizationTimezoneCanonical,
  formatOrganizationTimezonePrimary,
  isOrganizationSettingsDirty,
  isSettingsCategoryEnabled,
  organizationBrandInitials,
  planOrganizationSettingsSave,
  resetOrganizationSettingsDraft,
  shouldShowSettingsDirtyBar,
  toOrganizationSettingsDraft,
  type OrganizationSettingsDraft,
  type SettingsCategoryId,
} from "@/lib/settings/settings-workspace-derived";
import { cn } from "@/lib/utils";

const fieldClass =
  "min-h-11 w-full min-w-0 rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus-visible:ring-2";
const labelClass = "mb-1.5 block text-sm font-medium text-text";
const helperClass = "mt-1.5 text-[12px] leading-5 text-secondary-text";

export function SettingsWorkspacePage() {
  const { organization, currentLocation, membership } = useOrganization();
  const showLineEntry = canShowLineSettings(membership);
  const [boundOrgId, setBoundOrgId] = useState(organization.id);
  const [draft, setDraft] = useState<OrganizationSettingsDraft>(() =>
    toOrganizationSettingsDraft(organization),
  );
  const [feedback, setFeedback] = useState<"idle" | "success" | "error">("idle");
  const [saving, setSaving] = useState(false);
  const [category] = useState<SettingsCategoryId>("organization");

  if (organization.id !== boundOrgId) {
    setBoundOrgId(organization.id);
    setDraft(toOrganizationSettingsDraft(organization));
    setFeedback("idle");
  }

  const dirty = isOrganizationSettingsDirty(draft, organization);
  const showDirtyBar = shouldShowSettingsDirtyBar(dirty);
  const contextLabel = `${organization.name} · ${currentLocation?.name ?? "分店"}`;
  const initials = organizationBrandInitials(draft.name || organization.name);
  const showLogoUpload = canUploadOrganizationLogo(organization.logoUrl);

  const regionRows = useMemo(
    () => [
      {
        id: "timezone",
        label: "時區",
        primary: formatOrganizationTimezonePrimary(organization.timezone),
        secondary: formatOrganizationTimezoneCanonical(organization.timezone),
      },
      {
        id: "currency",
        label: "幣別",
        primary: formatOrganizationCurrencyLabel(organization.currency),
        secondary: organization.currency,
      },
      {
        id: "locale",
        label: "語言",
        primary: formatOrganizationLocaleLabel(organization.locale),
        secondary: organization.locale,
      },
    ],
    [organization.currency, organization.locale, organization.timezone],
  );

  function patch(partial: Partial<OrganizationSettingsDraft>) {
    setDraft((prev) => ({ ...prev, ...partial }));
    setFeedback("idle");
  }

  function handleCancel() {
    setDraft(resetOrganizationSettingsDraft(organization));
    setFeedback("idle");
  }

  function handleSave() {
    if (saving) return;
    setSaving(true);
    const saved = updateOrganizationLocal(
      organization.id,
      planOrganizationSettingsSave(draft),
    );
    setSaving(false);
    if (!saved) {
      setFeedback("error");
      return;
    }
    setDraft(toOrganizationSettingsDraft(saved));
    setFeedback("success");
  }

  return (
    <div
      data-settings-workspace
      data-settings-gap={SETTINGS_WORKSPACE_GAP_PX}
      data-settings-dirty={showDirtyBar ? "true" : "false"}
      className={cn("min-w-0", showDirtyBar && "pb-28 min-[1200px]:pb-24")}
    >
      <header className="mb-3 flex items-start justify-between gap-4">
        <div className="min-w-0 space-y-0.5">
          <p className="text-[11px] tracking-[0.18em] text-secondary-text">
            {PLATFORM_NAME}
          </p>
          <h1 className="text-xl font-semibold tracking-tight text-text sm:text-2xl">
            設定
          </h1>
          <p className="text-sm text-secondary-text">
            管理店家資料、營運規則與系統偏好
          </p>
          <p className="text-[12px] text-secondary-text/80">{contextLabel}</p>
        </div>
        <div className="hidden w-[220px] shrink-0 min-[720px]:block">
          <OrgLocationSwitcher compact />
        </div>
      </header>

      <div className="mb-3 min-[720px]:hidden">
        <OrgLocationSwitcher compact />
      </div>

      <div
        data-settings-category-nav
        className="-mx-1 mb-3 overflow-x-auto px-1"
        role="tablist"
        aria-label="設定分類"
      >
        <div className="inline-flex min-w-min gap-1 rounded-xl border border-border bg-surface p-1">
          {SETTINGS_CATEGORY_OPTIONS.map((entry) => {
            const enabled = isSettingsCategoryEnabled(entry.id);
            const selected = category === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                role="tab"
                data-settings-category={entry.id}
                aria-selected={selected}
                aria-disabled={!enabled}
                disabled={!enabled}
                tabIndex={enabled ? 0 : -1}
                className={cn(
                  "h-9 min-h-9 shrink-0 rounded-lg px-3 text-[13px] font-medium whitespace-nowrap transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                  selected && enabled
                    ? "bg-primary text-white"
                    : "border border-transparent bg-surface text-secondary-text",
                  !enabled && "cursor-not-allowed opacity-45",
                )}
                title={!enabled ? "即將提供" : undefined}
              >
                {entry.label}
              </button>
            );
          })}
        </div>
      </div>

      <div
        data-settings-split
        className="grid min-w-0 grid-cols-1 gap-4 min-[1200px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]"
      >
        <Card
          data-settings-basic
          padding="lg"
          className="min-w-0 space-y-5 shadow-none"
        >
          <div>
            <h2 className="text-[16px] font-semibold text-text">基本資料</h2>
            <p className="mt-1 text-[13px] leading-6 text-secondary-text">
              管理店家的基本資訊，這些資訊會顯示在系統與對外溝通中。
            </p>
          </div>

          <div>
            <label className={labelClass} htmlFor="settings-org-name">
              店家名稱
              <span className="ml-1 text-[12px] font-normal text-secondary-text">
                （必填）
              </span>
            </label>
            <input
              id="settings-org-name"
              name="name"
              required
              aria-required="true"
              className={fieldClass}
              value={draft.name}
              onChange={(event) => patch({ name: event.target.value })}
            />
          </div>

          <div>
            <label
              className="mb-1.5 block text-sm text-secondary-text"
              htmlFor="settings-org-slug"
            >
              店家代碼 / slug
            </label>
            <input
              id="settings-org-slug"
              name="slug"
              className={cn(fieldClass, "text-secondary-text")}
              value={draft.slug}
              onChange={(event) => patch({ slug: event.target.value })}
            />
            <p className={helperClass}>用於系統識別，修改可能影響既有連結。</p>
          </div>

          <div className="grid min-w-0 gap-4 sm:grid-cols-2">
            <div className="min-w-0">
              <label className={labelClass} htmlFor="settings-org-phone">
                電話
              </label>
              <input
                id="settings-org-phone"
                name="phone"
                type="tel"
                autoComplete="tel"
                className={fieldClass}
                value={draft.phone}
                onChange={(event) => patch({ phone: event.target.value })}
              />
            </div>
            <div className="min-w-0">
              <label className={labelClass} htmlFor="settings-org-email">
                Email
              </label>
              <input
                id="settings-org-email"
                name="email"
                type="email"
                autoComplete="email"
                className={cn(fieldClass, "break-all")}
                value={draft.email}
                onChange={(event) => patch({ email: event.target.value })}
              />
            </div>
          </div>

          <div className="min-w-0">
            <label className={labelClass} htmlFor="settings-org-address">
              地址
            </label>
            <input
              id="settings-org-address"
              name="address"
              autoComplete="street-address"
              className={fieldClass}
              value={draft.address}
              onChange={(event) => patch({ address: event.target.value })}
            />
          </div>

          <div
            data-settings-usage-note
            className="rounded-2xl bg-primary-light/50 px-4 py-3"
          >
            <p className="text-[12px] font-medium text-text">資料使用說明</p>
            <p className="mt-1 text-[12px] leading-5 text-secondary-text">
              以上資訊會應用在系統內的聯繫、通知以及與客戶的對外溝通。
              如需修改店家代碼，請先確認是否會影響既有連結或第三方整合。
            </p>
          </div>
        </Card>

        <div className="min-w-0 space-y-4">
          <Card
            data-settings-brand
            padding="lg"
            className="min-w-0 space-y-4 shadow-none"
          >
            <div>
              <h2 className="text-[16px] font-semibold text-text">品牌識別</h2>
              <p className="mt-1 text-[13px] leading-6 text-secondary-text">
                設定店家 Logo 與品牌顯示。
              </p>
            </div>
            <div className="flex items-center gap-4">
              <div
                className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-primary-light text-[18px] font-semibold text-primary"
                role="img"
                aria-label={`${draft.name.trim() || organization.name} 品牌標記`}
              >
                {initials}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[16px] font-semibold text-text">
                  {draft.name.trim() || organization.name}
                </p>
                <p className="mt-0.5 text-[13px] text-secondary-text">
                  {SETTINGS_BRAND_TAGLINE}
                </p>
              </div>
            </div>
            {showLogoUpload ? null : (
              <p className="text-[12px] text-secondary-text">
                Logo 上傳功能尚未提供
              </p>
            )}
          </Card>

          <Card
            data-settings-region
            padding="lg"
            className="min-w-0 space-y-4 shadow-none"
          >
            <div>
              <h2 className="text-[16px] font-semibold text-text">地區與格式</h2>
              <p className="mt-1 text-[13px] leading-6 text-secondary-text">
                設定店家的地區、貨幣與語言。
              </p>
            </div>
            <dl className="space-y-3">
              {regionRows.map((row) => (
                <div
                  key={row.id}
                  data-settings-region-row={row.id}
                  className="rounded-2xl border border-border/80 px-3.5 py-3"
                >
                  <dt className="text-[12px] text-secondary-text">{row.label}</dt>
                  <dd className="mt-1 text-[15px] font-medium text-text">
                    {row.primary}
                  </dd>
                  <dd className="mt-0.5 text-[12px] text-secondary-text">
                    {row.secondary}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>

      {showLineEntry ? (
        <Card
          data-line-settings-entry
          padding="lg"
          className="mt-4 min-w-0 space-y-2 shadow-none"
        >
          <h2 className="text-[16px] font-semibold text-text">LINE 官方帳號</h2>
          <p className="text-[13px] leading-6 text-secondary-text">
            為此店家連接 Messaging API，並管理文字群發。憑證只存在伺服器。
          </p>
          <Link href="/staff/settings/line" className="inline-flex min-h-11 items-center text-sm text-primary">
            管理 LINE 官方帳號
          </Link>
        </Card>
      ) : null}

      <div aria-live="polite" className="sr-only">
        {showDirtyBar ? "你有尚未儲存的變更" : ""}
        {feedback === "success" ? "店家設定已更新" : ""}
      </div>

      {feedback === "success" && !showDirtyBar ? (
        <p
          className="mt-4 text-[13px] text-[#5C7F66]"
          data-settings-success
        >
          店家設定已更新
        </p>
      ) : null}

      {feedback === "error" ? (
        <p role="alert" className="mt-4 text-[13px] text-danger" data-settings-error>
          無法儲存變更，請稍後再試
        </p>
      ) : null}

      {showDirtyBar ? (
        <div
          data-settings-dirty-bar
          className={cn(
            "fixed inset-x-0 z-30 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur-sm",
            "bottom-[calc(3.5rem+env(safe-area-inset-bottom))] min-[1200px]:bottom-0",
          )}
        >
          <div className="mx-auto flex w-full max-w-[1520px] flex-col gap-3 min-[720px]:flex-row min-[720px]:items-center min-[720px]:justify-between xl:max-w-[1680px]">
            <p className="flex items-center gap-2 text-[13px] text-text">
              <span
                className="inline-block h-2 w-2 rounded-full bg-primary"
                aria-hidden
              />
              你有尚未儲存的變更
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={handleCancel}
              >
                取消變更
              </Button>
              <Button
                type="button"
                className="min-h-11"
                disabled={saving}
                onClick={handleSave}
              >
                儲存變更
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
