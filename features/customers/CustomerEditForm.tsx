"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { useCrmJson, useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import {
  CUSTOMER_SOURCE_LABEL,
  type CustomerGender,
  type CustomerSource,
} from "@/types/customer";
import type { Customer, MembershipTier } from "@/types";

const fieldClass =
  "min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus:ring-2";
const labelClass = "mb-1.5 block text-sm text-secondary-text";

type EditFormState = {
  name: string;
  phone: string;
  email: string;
  lineId: string;
  birthday: string;
  gender: CustomerGender | "";
  occupation: string;
  address: string;
  source: CustomerSource | "";
  membership: MembershipTier;
};

function fromCustomer(c: Customer): EditFormState {
  return {
    name: c.name,
    phone: c.phone,
    email: c.email ?? "",
    lineId: c.lineId ?? "",
    birthday: c.birthday ?? "",
    gender: c.gender ?? "",
    occupation: c.occupation ?? "",
    address: c.address ?? "",
    source: c.source ?? "",
    membership: c.membership,
  };
}

interface CustomerEditFormProps {
  customerId: string;
}

export function CustomerEditForm({ customerId }: CustomerEditFormProps) {
  const router = useRouter();
  const { organization } = useOrganization();
  const isClient = useIsClient();
  const customer = useCrmJson(
    () =>
      localCustomerRepository.getById({
        organizationId: organization.id,
        id: customerId,
      }) ?? null,
    null as Customer | null,
  );
  const [form, setForm] = useState<EditFormState | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  if (!isClient) {
    return (
      <div className="h-40 animate-pulse rounded-2xl bg-primary-light/40" />
    );
  }

  if (!customer) {
    return (
      <Card padding="lg" className="text-center">
        <p className="text-[15px] font-medium text-text">找不到此客戶</p>
        <p className="mt-2 text-sm text-secondary-text">
          Access unavailable — 此客戶不屬於目前店家，或資料不存在。
        </p>
        <Link
          href="/staff/customers"
          className="mt-3 inline-flex min-h-11 items-center text-primary"
        >
          返回客戶管理
        </Link>
      </Card>
    );
  }

  const state = form ?? fromCustomer(customer);

  function patch(partial: Partial<EditFormState>) {
    setForm((prev) => ({ ...(prev ?? fromCustomer(customer!)), ...partial }));
    setError("");
  }

  function handleSave() {
    setSaving(true);
    setError("");
    try {
      if (!state.name.trim()) throw new Error("姓名為必填");
      if (!state.phone.trim()) throw new Error("電話為必填");
      localCustomerRepository.updateProfile(organization.id, customerId, {
        name: state.name,
        phone: state.phone,
        email: state.email,
        lineId: state.lineId,
        birthday: state.birthday,
        gender: state.gender || undefined,
        occupation: state.occupation,
        address: state.address,
        source: state.source || undefined,
        membership: state.membership,
      });
      router.push(`/staff/customers/${customerId}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "儲存失敗");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <Link
        href={`/staff/customers/${customerId}`}
        className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text hover:text-text"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        返回客戶資料
      </Link>

      <Card padding="lg" className="space-y-4">
        <div>
          <h1 className="text-xl font-semibold text-text">編輯客戶資料</h1>
          <p className="mt-1 text-sm text-secondary-text">
            客戶編號與所屬店家不可變更
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="edit-name">
              姓名 *
            </label>
            <input
              id="edit-name"
              className={fieldClass}
              value={state.name}
              onChange={(e) => patch({ name: e.target.value })}
              autoComplete="name"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-phone">
              電話 *
            </label>
            <input
              id="edit-phone"
              className={fieldClass}
              value={state.phone}
              onChange={(e) => patch({ phone: e.target.value })}
              inputMode="tel"
              autoComplete="tel"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-birthday">
              生日
            </label>
            <input
              id="edit-birthday"
              className={fieldClass}
              value={state.birthday}
              onChange={(e) => patch({ birthday: e.target.value })}
              placeholder="YYYY/MM/DD"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-email">
              Email
            </label>
            <input
              id="edit-email"
              className={fieldClass}
              value={state.email}
              onChange={(e) => patch({ email: e.target.value })}
              type="email"
              autoComplete="email"
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-line">
              LINE ID
            </label>
            <input
              id="edit-line"
              className={fieldClass}
              value={state.lineId}
              onChange={(e) => patch({ lineId: e.target.value })}
            />
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-gender">
              性別
            </label>
            <select
              id="edit-gender"
              className={fieldClass}
              value={state.gender}
              onChange={(e) =>
                patch({ gender: e.target.value as CustomerGender | "" })
              }
            >
              <option value="">未指定</option>
              <option value="female">女</option>
              <option value="male">男</option>
              <option value="other">其他</option>
              <option value="unspecified">不便透露</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-membership">
              會員層級
            </label>
            <select
              id="edit-membership"
              className={fieldClass}
              value={state.membership}
              onChange={(e) =>
                patch({ membership: e.target.value as MembershipTier })
              }
            >
              <option value="new">新客</option>
              <option value="regular">熟客</option>
              <option value="vip">VIP</option>
            </select>
          </div>
          <div>
            <label className={labelClass} htmlFor="edit-source">
              來源
            </label>
            <select
              id="edit-source"
              className={fieldClass}
              value={state.source}
              onChange={(e) =>
                patch({ source: e.target.value as CustomerSource | "" })
              }
            >
              <option value="">未設定</option>
              {(Object.keys(CUSTOMER_SOURCE_LABEL) as CustomerSource[]).map(
                (key) => (
                  <option key={key} value={key}>
                    {CUSTOMER_SOURCE_LABEL[key]}
                  </option>
                ),
              )}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="edit-occupation">
              職業
            </label>
            <input
              id="edit-occupation"
              className={fieldClass}
              value={state.occupation}
              onChange={(e) => patch({ occupation: e.target.value })}
            />
          </div>
          <div className="sm:col-span-2">
            <label className={labelClass} htmlFor="edit-address">
              地址
            </label>
            <input
              id="edit-address"
              className={fieldClass}
              value={state.address}
              onChange={(e) => patch({ address: e.target.value })}
              autoComplete="street-address"
            />
          </div>
        </div>

        {error ? (
          <p className="text-sm text-red-600" role="alert">
            {error}
          </p>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link href={`/staff/customers/${customerId}`} className="sm:order-1">
            <Button variant="ghost" fullWidth className="min-h-11">
              取消
            </Button>
          </Link>
          <Button
            className="min-h-11 sm:order-2"
            fullWidth
            disabled={saving}
            onClick={handleSave}
          >
            {saving ? "儲存中…" : "儲存"}
          </Button>
        </div>
      </Card>
    </div>
  );
}
