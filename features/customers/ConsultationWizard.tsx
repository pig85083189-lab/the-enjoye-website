"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, Check } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getSession } from "@/lib/auth";
import { formatPhoneDisplay } from "@/lib/phone";
import { newId } from "@/lib/repositories/storage";
import { localCustomerRepository } from "@/lib/repositories/local-customer-repository";
import { localConsultationRepository } from "@/lib/repositories/local-consultation-repository";
import {
  clearConsultationDraft,
  loadConsultationDraft,
  saveConsultationDraft,
} from "@/lib/repositories/consultation-draft";
import { useIsClient } from "@/lib/repositories/use-crm-store";
import { useOrganization } from "@/lib/tenant/OrganizationContext";
import { cn } from "@/lib/utils";
import type { Customer } from "@/types";
import {
  CHAT_PREF_LABEL,
  CONSULTATION_GOAL_LABEL,
  CUSTOMER_SOURCE_LABEL,
  HEALTH_ITEM_DEFS,
  PRESET_CUSTOMER_TAGS,
  PRESSURE_LABEL,
  TEMPERATURE_LABEL,
  type ChatPreference,
  type ConsultationGoalId,
  type ConsultationHealthItem,
  type CustomerGender,
  type CustomerSource,
  type PressurePreference,
  type TemperaturePreference,
} from "@/types/customer";

const STEPS = [
  "基本資料",
  "本次需求",
  "身體狀況",
  "女性相關",
  "服務歷史",
  "服務偏好",
  "諮詢確認",
] as const;

const GOAL_IDS = Object.keys(CONSULTATION_GOAL_LABEL) as ConsultationGoalId[];
const PRE_PERIOD = ["胸部脹", "水腫", "腹部不適", "情緒變化", "其他"];
const LIFE_STAGE = ["懷孕", "哺乳", "產後", "停經", "其他需注意狀況"];
const PAST_SERVICES = ["美胸", "按摩", "體雕", "臉部保養", "醫美", "雷射", "其他"];

type FormState = {
  name: string;
  phone: string;
  birthday: string;
  lineId: string;
  email: string;
  gender: CustomerGender;
  occupation: string;
  address: string;
  source: CustomerSource | "";
  primaryStaffId: string;
  primaryStaffName: string;
  goals: ConsultationGoalId[];
  goalNote: string;
  healthItems: ConsultationHealthItem[];
  femaleSkipped: boolean;
  cycleStatus: string;
  lastPeriodDate: string;
  cycleRegular: "" | "yes" | "no";
  prePeriodSymptoms: string[];
  lifeStageNotes: string[];
  pastServices: string[];
  lastServiceAt: string;
  adverseReactionNote: string;
  pressure: PressurePreference | "";
  chatPreference: ChatPreference | "";
  temperature: TemperaturePreference | "";
  scentPreference: string;
  scentDislikes: string;
  sensitiveProducts: string;
  preferenceNotes: string;
  customerConfirmed: boolean;
  signatureText: string;
  forceCreateDuplicate: boolean;
};

function emptyHealth(): ConsultationHealthItem[] {
  return HEALTH_ITEM_DEFS.map((item) => ({
    id: item.id,
    label: item.label,
    checked: false,
    note: "",
  }));
}

function createEmptyForm(): FormState {
  return {
    name: "",
    phone: "",
    birthday: "",
    lineId: "",
    email: "",
    gender: "female",
    occupation: "",
    address: "",
    source: "",
    primaryStaffId: "staff-001",
    primaryStaffName: "美容師",
    goals: [],
    goalNote: "",
    healthItems: emptyHealth(),
    femaleSkipped: false,
    cycleStatus: "",
    lastPeriodDate: "",
    cycleRegular: "",
    prePeriodSymptoms: [],
    lifeStageNotes: [],
    pastServices: [],
    lastServiceAt: "",
    adverseReactionNote: "",
    pressure: "",
    chatPreference: "",
    temperature: "",
    scentPreference: "",
    scentDislikes: "",
    sensitiveProducts: "",
    preferenceNotes: "",
    customerConfirmed: false,
    signatureText: "",
    forceCreateDuplicate: false,
  };
}

function ageFromBirthday(birthday: string): number {
  const parts = birthday.split(/[/-]/).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return 0;
  const [y, m, d] = parts;
  const today = new Date();
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age -= 1;
  return age;
}

function toggleInList<T extends string>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

const fieldClass =
  "min-h-11 w-full rounded-2xl border border-border bg-surface px-4 text-[15px] text-text outline-none ring-primary/30 focus:ring-2";
const labelClass = "mb-1.5 block text-sm text-secondary-text";

interface ConsultationWizardProps {
  mode: "new" | "existing";
  customerId?: string;
}

function buildInitialState(
  organizationId: string,
  mode: "new" | "existing",
  draftKey: string,
  customerId?: string,
  staffFallback?: { id: string; name: string },
): { form: FormState; step: number } {
  const draft = loadConsultationDraft(organizationId, draftKey);
  if (draft?.form) {
    return {
      form: { ...createEmptyForm(), ...(draft.form as Partial<FormState>) },
      step: typeof draft.step === "number" ? draft.step : 0,
    };
  }
  const staffId = staffFallback?.id ?? "staff-001";
  const staffName = staffFallback?.name ?? "美容師";
  if (mode === "existing" && customerId) {
    const existing = localCustomerRepository.getById({
      organizationId,
      id: customerId,
    });
    if (existing) {
      return {
        form: {
          ...createEmptyForm(),
          name: existing.name,
          phone: existing.phone,
          birthday: existing.birthday,
          lineId: existing.lineId ?? "",
          email: existing.email ?? "",
          gender: existing.gender ?? "female",
          occupation: existing.occupation ?? "",
          address: existing.address ?? "",
          source: existing.source ?? "",
          primaryStaffId: existing.primaryStaffId ?? staffId,
          primaryStaffName: existing.primaryStaffName ?? staffName,
        },
        step: 0,
      };
    }
  }
  const empty = createEmptyForm();
  return {
    form: {
      ...empty,
      primaryStaffId: staffId,
      primaryStaffName: staffName,
    },
    step: 0,
  };
}

export function ConsultationWizard({ mode, customerId }: ConsultationWizardProps) {
  const isClient = useIsClient();
  if (!isClient) {
    return <div className="h-40 animate-pulse rounded-2xl bg-primary-light/40" />;
  }
  return <ConsultationWizardInner mode={mode} customerId={customerId} />;
}

function ConsultationWizardInner({ mode, customerId }: ConsultationWizardProps) {
  const router = useRouter();
  const { organization, membership } = useOrganization();
  const draftKey = mode === "new" ? "new" : (customerId ?? "new");
  const staffFallback = {
    id: membership?.userId ?? "staff-001",
    name: membership?.displayName ?? "美容師",
  };
  const [boot] = useState(() =>
    buildInitialState(organization.id, mode, draftKey, customerId, staffFallback),
  );
  const [step, setStep] = useState(boot.step);
  const [form, setForm] = useState<FormState>(boot.form);
  const [savedFlash, setSavedFlash] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const duplicates = useMemo(() => {
    if (mode !== "new" || !form.phone.trim()) return [];
    return localCustomerRepository.findByPhone({
      organizationId: organization.id,
      phone: form.phone,
    });
  }, [form.phone, mode, organization.id]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => {
      saveConsultationDraft({
        step,
        organizationId: organization.id,
        customerId: draftKey,
        form: form as unknown as Record<string, unknown>,
        updatedAt: new Date().toISOString(),
      });
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1600);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [dirty, draftKey, form, organization.id, step]);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const patch = useCallback((partial: Partial<FormState>) => {
    setForm((prev) => ({ ...prev, ...partial }));
    setDirty(true);
  }, []);

  function canProceed(): boolean {
    if (step === 0) {
      if (!form.name.trim() || !form.phone.trim()) return false;
      if (mode === "new" && duplicates.length > 0 && !form.forceCreateDuplicate) return false;
      return true;
    }
    if (step === 6) {
      return form.customerConfirmed && form.signatureText.trim().length > 0;
    }
    return true;
  }

  function handleComplete() {
    if (!canProceed() || submitting) return;
    setSubmitting(true);
    const session = getSession();
    const now = new Date().toISOString();
    const consultedBy = session?.staffId ?? membership?.userId ?? "staff-001";
    const consultedByName =
      session?.name ?? membership?.displayName ?? "美容師";

    let targetId = customerId ?? "";
    let customer: Customer;

    if (mode === "new") {
      targetId = newId("cust");
      const membershipType = "new" as const;
      const tags = [PRESET_CUSTOMER_TAGS.new];
      if (form.goals.some((g) => g.includes("breast") || g === "outward" || g === "sagging")) {
        tags.push(PRESET_CUSTOMER_TAGS.breast);
      }
      customer = {
        id: targetId,
        organizationId: organization.id,
        name: form.name.trim(),
        phone: formatPhoneDisplay(form.phone),
        birthday: form.birthday,
        age: ageFromBirthday(form.birthday),
        membership: membershipType,
        lastVisit: "",
        totalVisits: 0,
        packages: [],
        lastServiceNotes: [],
        trackingFocus: form.goals.slice(0, 3).map((g) => CONSULTATION_GOAL_LABEL[g]),
        alerts: [],
        tags,
        email: form.email || undefined,
        lineId: form.lineId || undefined,
        gender: form.gender,
        occupation: form.occupation || undefined,
        address: form.address || undefined,
        source: form.source || undefined,
        primaryStaffId: form.primaryStaffId,
        primaryStaffName: form.primaryStaffName,
        joinedAt: now.slice(0, 10).replace(/-/g, "/"),
        nextAppointmentAt: null,
        nextAppointmentLabel: null,
        lastServiceName: undefined,
        importantNotes: form.healthItems
          .filter((h) => h.checked)
          .map((h) => (h.note ? `${h.label}：${h.note}` : h.label))
          .slice(0, 5),
        listStatus: "normal",
        preferences: {
          preferredStaffId: form.primaryStaffId,
          preferredStaffName: form.primaryStaffName,
          pressure: form.pressure || undefined,
          chatPreference: form.chatPreference || undefined,
          temperature: form.temperature || undefined,
          scentPreference: form.scentPreference || undefined,
          scentDislikes: form.scentDislikes || undefined,
          sensitiveProducts: form.sensitiveProducts || undefined,
          notes: form.preferenceNotes || undefined,
        },
        createdAt: now,
        updatedAt: now,
      };
      localCustomerRepository.upsert(customer);
    } else {
      const existing = localCustomerRepository.getById({
        organizationId: organization.id,
        id: targetId,
      });
      if (!existing) {
        setSubmitting(false);
        return;
      }
      customer = {
        ...existing,
        organizationId: organization.id,
        preferences: {
          preferredStaffId: form.primaryStaffId,
          preferredStaffName: form.primaryStaffName,
          pressure: form.pressure || existing.preferences?.pressure,
          chatPreference: form.chatPreference || existing.preferences?.chatPreference,
          temperature: form.temperature || existing.preferences?.temperature,
          scentPreference: form.scentPreference || existing.preferences?.scentPreference,
          scentDislikes: form.scentDislikes || existing.preferences?.scentDislikes,
          sensitiveProducts: form.sensitiveProducts || existing.preferences?.sensitiveProducts,
          notes: form.preferenceNotes || existing.preferences?.notes,
        },
        updatedAt: now,
      };
      localCustomerRepository.upsert(customer);
    }

    const kind = mode === "new" ? "initial" : "update";
    localConsultationRepository.create({
      id: newId("consult"),
      organizationId: organization.id,
      customerId: targetId,
      kind,
      title: kind === "initial" ? "初次諮詢" : "定期更新",
      goals: form.goals,
      goalNote: form.goalNote,
      healthItems: form.healthItems,
      femaleCycle: form.femaleSkipped
        ? { skipped: true }
        : {
            skipped: false,
            currentStatus: form.cycleStatus,
            lastPeriodDate: form.lastPeriodDate,
            isRegular:
              form.cycleRegular === "" ? null : form.cycleRegular === "yes",
            prePeriodSymptoms: form.prePeriodSymptoms,
            lifeStageNotes: form.lifeStageNotes,
          },
      spaHistory: {
        pastServices: form.pastServices,
        lastServiceAt: form.lastServiceAt,
        adverseReactionNote: form.adverseReactionNote,
      },
      preferences: customer.preferences ?? undefined,
      basicSnapshot: {
        name: form.name,
        phone: form.phone,
        birthday: form.birthday,
        lineId: form.lineId,
        email: form.email,
        gender: form.gender,
        occupation: form.occupation,
        address: form.address,
        source: form.source || undefined,
        primaryStaffId: form.primaryStaffId,
        primaryStaffName: form.primaryStaffName,
      },
      customerConfirmed: true,
      signatureText: form.signatureText.trim(),
      consultedAt: now,
      consultedBy,
      consultedByName,
      customerConfirmedAt: now,
      createdAt: now,
      updatedAt: now,
    });

    clearConsultationDraft(organization.id, draftKey);
    setDirty(false);
    router.push(`/staff/customers/${targetId}`);
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href={mode === "existing" && customerId ? `/staff/customers/${customerId}` : "/staff/customers"}
          className="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-secondary-text"
        >
          <ArrowLeft className="h-4 w-4" />
          返回
        </Link>
        <div className="flex items-center gap-3 text-sm text-secondary-text">
          {savedFlash ? <span className="text-success">已自動儲存</span> : null}
          <span>僅供內部服務紀錄使用</span>
        </div>
      </div>

      <div>
        <h1 className="text-2xl font-semibold text-text">
          {mode === "new" ? "新增客戶 + 電子諮詢表" : "電子諮詢更新"}
        </h1>
        <p className="mt-1 text-[15px] text-secondary-text">
          為了讓美容師提供更適合您的服務，請協助確認以下狀況。
        </p>
      </div>

      {/* Mobile progress */}
      <div className="min-[1000px]:hidden">
        <p className="text-sm text-secondary-text">
          步驟 {step + 1} / {STEPS.length} · {STEPS[step]}
        </p>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary-light">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${((step + 1) / STEPS.length) * 100}%` }}
          />
        </div>
      </div>

      <div className="grid gap-5 min-[1000px]:grid-cols-[220px_minmax(0,1fr)]">
        <nav className="hidden min-[1000px]:block">
          <Card padding="sm" className="sticky top-6 space-y-1">
            {STEPS.map((label, index) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  if (index <= step) setStep(index);
                }}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm",
                  index === step
                    ? "bg-primary-light text-primary font-medium"
                    : index < step
                      ? "text-text hover:bg-primary-light/40"
                      : "text-secondary-text",
                )}
              >
                <span
                  className={cn(
                    "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs",
                    index <= step ? "bg-primary text-white" : "bg-border text-secondary-text",
                  )}
                >
                  {index < step ? <Check className="h-3.5 w-3.5" /> : index + 1}
                </span>
                {label}
              </button>
            ))}
          </Card>
        </nav>

        <Card padding="lg" className="space-y-5">
          {step === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-1">
                <label className={labelClass}>姓名 *</label>
                <input
                  className={fieldClass}
                  value={form.name}
                  onChange={(e) => patch({ name: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>手機 *</label>
                <input
                  className={fieldClass}
                  value={form.phone}
                  onChange={(e) =>
                    patch({ phone: e.target.value, forceCreateDuplicate: false })
                  }
                />
              </div>
              {duplicates.length > 0 ? (
                <div className="sm:col-span-2 rounded-2xl border border-[#E8D5C4] bg-[#FBF6F0] p-4">
                  <p className="font-medium text-text">可能已有相同客戶</p>
                  {duplicates.map((d) => (
                    <div key={d.id} className="mt-2 flex flex-wrap items-center gap-3 text-[15px]">
                      <span>
                        {d.name} · {d.phone}
                      </span>
                      <Link
                        href={`/staff/customers/${d.id}`}
                        className="min-h-11 inline-flex items-center font-medium text-primary"
                      >
                        查看客戶
                      </Link>
                    </div>
                  ))}
                  <label className="mt-3 flex min-h-11 items-center gap-2 text-[15px]">
                    <input
                      type="checkbox"
                      checked={form.forceCreateDuplicate}
                      onChange={(e) => patch({ forceCreateDuplicate: e.target.checked })}
                      className="accent-primary"
                    />
                    仍要建立新客戶
                  </label>
                </div>
              ) : null}
              <div>
                <label className={labelClass}>生日</label>
                <input
                  className={fieldClass}
                  placeholder="YYYY/MM/DD"
                  value={form.birthday}
                  onChange={(e) => patch({ birthday: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>LINE ID</label>
                <input
                  className={fieldClass}
                  value={form.lineId}
                  onChange={(e) => patch({ lineId: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>Email</label>
                <input
                  className={fieldClass}
                  value={form.email}
                  onChange={(e) => patch({ email: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>性別</label>
                <select
                  className={fieldClass}
                  value={form.gender}
                  onChange={(e) => patch({ gender: e.target.value as CustomerGender })}
                >
                  <option value="female">女性</option>
                  <option value="male">男性</option>
                  <option value="other">其他</option>
                  <option value="unspecified">不指定</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>職業</label>
                <input
                  className={fieldClass}
                  value={form.occupation}
                  onChange={(e) => patch({ occupation: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>來源</label>
                <select
                  className={fieldClass}
                  value={form.source}
                  onChange={(e) => patch({ source: e.target.value as CustomerSource | "" })}
                >
                  <option value="">請選擇</option>
                  {(Object.keys(CUSTOMER_SOURCE_LABEL) as CustomerSource[]).map((key) => (
                    <option key={key} value={key}>
                      {CUSTOMER_SOURCE_LABEL[key]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className={labelClass}>地址（選填）</label>
                <input
                  className={fieldClass}
                  value={form.address}
                  onChange={(e) => patch({ address: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>負責美容師</label>
                <input className={fieldClass} value={form.primaryStaffName} readOnly />
              </div>
            </div>
          ) : null}

          {step === 1 ? (
            <div className="space-y-4">
              <p className="text-[15px] text-text">今天最想改善什麼？</p>
              <div className="flex flex-wrap gap-2">
                {GOAL_IDS.map((id) => {
                  const active = form.goals.includes(id);
                  return (
                    <button
                      key={id}
                      type="button"
                      onClick={() => patch({ goals: toggleInList(form.goals, id) })}
                      className={cn(
                        "min-h-11 rounded-2xl px-4 text-sm font-medium",
                        active ? "bg-primary text-white" : "bg-primary-light/70 text-text",
                      )}
                    >
                      {CONSULTATION_GOAL_LABEL[id]}
                    </button>
                  );
                })}
              </div>
              <div>
                <label className={labelClass}>期望改善</label>
                <textarea
                  rows={4}
                  className="w-full rounded-2xl border border-border px-4 py-3 text-[15px] outline-none ring-primary/30 focus:ring-2"
                  value={form.goalNote}
                  onChange={(e) => patch({ goalNote: e.target.value })}
                />
              </div>
            </div>
          ) : null}

          {step === 2 ? (
            <div className="space-y-3">
              <p className="text-[15px] leading-relaxed text-secondary-text">
                為了讓美容師提供更適合您的服務，請協助確認以下狀況。此區僅作為服務參考，不進行醫療診斷。
              </p>
              {form.healthItems.map((item, index) => (
                <div key={item.id} className="rounded-2xl border border-border p-3">
                  <label className="flex min-h-11 items-center gap-3 text-[15px]">
                    <input
                      type="checkbox"
                      checked={item.checked}
                      onChange={(e) => {
                        const next = [...form.healthItems];
                        next[index] = { ...item, checked: e.target.checked };
                        patch({ healthItems: next });
                      }}
                      className="accent-primary"
                    />
                    {item.label}
                  </label>
                  {item.checked ? (
                    <textarea
                      rows={2}
                      placeholder="補充說明"
                      className="mt-2 w-full rounded-xl border border-border px-3 py-2 text-sm outline-none"
                      value={item.note ?? ""}
                      onChange={(e) => {
                        const next = [...form.healthItems];
                        next[index] = { ...item, note: e.target.value };
                        patch({ healthItems: next });
                      }}
                    />
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}

          {step === 3 ? (
            <div className="space-y-4">
              <Button
                variant="secondary"
                className="min-h-11"
                onClick={() => {
                  patch({ femaleSkipped: true });
                  setStep(4);
                  setDirty(true);
                }}
              >
                略過此步驟
              </Button>
              <div>
                <label className={labelClass}>目前生理期狀況</label>
                <input
                  className={fieldClass}
                  value={form.cycleStatus}
                  onChange={(e) => patch({ femaleSkipped: false, cycleStatus: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>最近一次生理期</label>
                <input
                  className={fieldClass}
                  placeholder="YYYY/MM/DD"
                  value={form.lastPeriodDate}
                  onChange={(e) =>
                    patch({ femaleSkipped: false, lastPeriodDate: e.target.value })
                  }
                />
              </div>
              <div>
                <label className={labelClass}>週期是否規律</label>
                <select
                  className={fieldClass}
                  value={form.cycleRegular}
                  onChange={(e) =>
                    patch({
                      femaleSkipped: false,
                      cycleRegular: e.target.value as "" | "yes" | "no",
                    })
                  }
                >
                  <option value="">未填</option>
                  <option value="yes">是</option>
                  <option value="no">否</option>
                </select>
              </div>
              <div>
                <p className={labelClass}>經期前是否容易</p>
                <div className="flex flex-wrap gap-2">
                  {PRE_PERIOD.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        "min-h-11 rounded-2xl px-4 text-sm",
                        form.prePeriodSymptoms.includes(item)
                          ? "bg-primary text-white"
                          : "bg-primary-light/70",
                      )}
                      onClick={() =>
                        patch({
                          femaleSkipped: false,
                          prePeriodSymptoms: toggleInList(form.prePeriodSymptoms, item),
                        })
                      }
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={labelClass}>是否有</p>
                <div className="flex flex-wrap gap-2">
                  {LIFE_STAGE.map((item) => (
                    <button
                      key={item}
                      type="button"
                      className={cn(
                        "min-h-11 rounded-2xl px-4 text-sm",
                        form.lifeStageNotes.includes(item)
                          ? "bg-primary text-white"
                          : "bg-primary-light/70",
                      )}
                      onClick={() =>
                        patch({
                          femaleSkipped: false,
                          lifeStageNotes: toggleInList(form.lifeStageNotes, item),
                        })
                      }
                    >
                      {item}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {step === 4 ? (
            <div className="space-y-4">
              <p className={labelClass}>過去是否接受過</p>
              <div className="flex flex-wrap gap-2">
                {PAST_SERVICES.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={cn(
                      "min-h-11 rounded-2xl px-4 text-sm",
                      form.pastServices.includes(item)
                        ? "bg-primary text-white"
                        : "bg-primary-light/70",
                    )}
                    onClick={() =>
                      patch({ pastServices: toggleInList(form.pastServices, item) })
                    }
                  >
                    {item}
                  </button>
                ))}
              </div>
              <div>
                <label className={labelClass}>最近一次服務時間</label>
                <input
                  className={fieldClass}
                  value={form.lastServiceAt}
                  onChange={(e) => patch({ lastServiceAt: e.target.value })}
                />
              </div>
              <div>
                <label className={labelClass}>是否曾有不舒服或過敏反應</label>
                <textarea
                  rows={3}
                  className="w-full rounded-2xl border border-border px-4 py-3 text-[15px] outline-none"
                  value={form.adverseReactionNote}
                  onChange={(e) => patch({ adverseReactionNote: e.target.value })}
                />
              </div>
            </div>
          ) : null}

          {step === 5 ? (
            <div className="space-y-4">
              <div>
                <p className={labelClass}>力道</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(PRESSURE_LABEL) as PressurePreference[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "min-h-11 rounded-2xl px-4 text-sm",
                        form.pressure === key ? "bg-primary text-white" : "bg-primary-light/70",
                      )}
                      onClick={() => patch({ pressure: key })}
                    >
                      {PRESSURE_LABEL[key]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={labelClass}>服務偏好</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(CHAT_PREF_LABEL) as ChatPreference[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "min-h-11 rounded-2xl px-4 text-sm",
                        form.chatPreference === key
                          ? "bg-primary text-white"
                          : "bg-primary-light/70",
                      )}
                      onClick={() => patch({ chatPreference: key })}
                    >
                      {CHAT_PREF_LABEL[key]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <p className={labelClass}>溫度</p>
                <div className="flex flex-wrap gap-2">
                  {(Object.keys(TEMPERATURE_LABEL) as TemperaturePreference[]).map((key) => (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        "min-h-11 rounded-2xl px-4 text-sm",
                        form.temperature === key
                          ? "bg-primary text-white"
                          : "bg-primary-light/70",
                      )}
                      onClick={() => patch({ temperature: key })}
                    >
                      {TEMPERATURE_LABEL[key]}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className={labelClass}>產品 / 香味偏好</label>
                  <input
                    className={fieldClass}
                    value={form.scentPreference}
                    onChange={(e) => patch({ scentPreference: e.target.value })}
                  />
                </div>
                <div>
                  <label className={labelClass}>不喜歡</label>
                  <input
                    className={fieldClass}
                    value={form.scentDislikes}
                    onChange={(e) => patch({ scentDislikes: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>敏感產品</label>
                  <input
                    className={fieldClass}
                    value={form.sensitiveProducts}
                    onChange={(e) => patch({ sensitiveProducts: e.target.value })}
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className={labelClass}>備註</label>
                  <textarea
                    rows={3}
                    className="w-full rounded-2xl border border-border px-4 py-3 text-[15px]"
                    value={form.preferenceNotes}
                    onChange={(e) => patch({ preferenceNotes: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : null}

          {step === 6 ? (
            <div className="space-y-4 text-[15px]">
              <section>
                <h3 className="font-semibold text-text">基本資料</h3>
                <p className="mt-1 text-secondary-text">
                  {form.name} · {form.phone}
                  {form.source ? ` · ${CUSTOMER_SOURCE_LABEL[form.source]}` : ""}
                </p>
              </section>
              <section>
                <h3 className="font-semibold text-text">主要需求</h3>
                <p className="mt-1 text-secondary-text">
                  {form.goals.map((g) => CONSULTATION_GOAL_LABEL[g]).join("、") || "—"}
                </p>
              </section>
              <section>
                <h3 className="font-semibold text-text">重要身體狀況</h3>
                <p className="mt-1 text-secondary-text">
                  {form.healthItems
                    .filter((h) => h.checked)
                    .map((h) => h.label)
                    .join("、") || "無勾選項目"}
                </p>
              </section>
              <section>
                <h3 className="font-semibold text-text">服務歷史</h3>
                <p className="mt-1 text-secondary-text">
                  {form.pastServices.join("、") || "—"}
                </p>
              </section>
              <section>
                <h3 className="font-semibold text-text">偏好</h3>
                <p className="mt-1 text-secondary-text">
                  {[
                    form.pressure ? PRESSURE_LABEL[form.pressure] : null,
                    form.chatPreference ? CHAT_PREF_LABEL[form.chatPreference] : null,
                    form.temperature ? TEMPERATURE_LABEL[form.temperature] : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"}
                </p>
              </section>

              <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-border p-3">
                <input
                  type="checkbox"
                  className="mt-1 accent-primary"
                  checked={form.customerConfirmed}
                  onChange={(e) => patch({ customerConfirmed: e.target.checked })}
                />
                <span>以上資料由本人提供，並已確認內容正確。</span>
              </label>

              <div>
                <label className={labelClass}>簽名（請輸入姓名）</label>
                <div className="rounded-2xl border border-dashed border-primary/40 bg-primary-light/20 p-4">
                  <input
                    className="min-h-12 w-full border-0 bg-transparent text-center font-display text-2xl text-primary outline-none"
                    placeholder="在此簽名"
                    value={form.signatureText}
                    onChange={(e) => patch({ signatureText: e.target.value })}
                  />
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap justify-between gap-3 border-t border-border pt-4">
            <Button
              variant="ghost"
              className="min-h-11"
              disabled={step === 0}
              onClick={() => setStep((s) => Math.max(0, s - 1))}
            >
              上一步
            </Button>
            {step < STEPS.length - 1 ? (
              <Button
                className="min-h-11"
                disabled={!canProceed()}
                onClick={() => {
                  setStep((s) => s + 1);
                  setDirty(true);
                }}
              >
                下一步
              </Button>
            ) : (
              <Button
                className="min-h-11"
                disabled={!canProceed() || submitting}
                onClick={handleComplete}
              >
                完成諮詢
              </Button>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
