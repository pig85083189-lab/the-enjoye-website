"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { AuthAlert, AuthBrand, AuthCard } from "@/features/auth/AuthShell";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import { setStaffAuthUser } from "@/lib/staff-auth/session";
import { applyRemoteMembershipsToClient } from "@/lib/staff-auth/membership-query";
import { listMyStaffMembershipsAction } from "@/lib/staff-auth/actions";
import { safeStaffNextPath } from "@/lib/staff-auth/redirect";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";
import { emitOrgChange } from "@/lib/tenant/organization-store";

export function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorKind, setErrorKind] = useState<
    "config" | "credentials" | "network" | ""
  >("");
  const [submitting, setSubmitting] = useState(false);
  const supabaseReady = Boolean(tryGetSupabaseEnv());

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorKind("");
    if (!supabaseReady) {
      setErrorKind("config");
      return;
    }
    const supabase = createBrowserClientOrNull();
    if (!supabase) {
      setErrorKind("config");
      return;
    }
    setSubmitting(true);
    try {
      const { data, error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      if (signInError || !data.user) {
        setErrorKind("credentials");
        setSubmitting(false);
        return;
      }
      setStaffAuthUser({
        id: data.user.id,
        email: data.user.email ?? null,
      });
      try {
        const rows = await listMyStaffMembershipsAction();
        applyRemoteMembershipsToClient(rows);
        emitOrgChange();
      } catch {
        // Membership hydrate is best-effort; Access Unavailable handles empty mapping.
      }
      router.push(safeStaffNextPath(searchParams.get("next")));
      router.refresh();
    } catch {
      setErrorKind("network");
      setSubmitting(false);
    }
  }

  return (
    <AuthCard data-staff-login-card>
      <AuthBrand title="歡迎回來" description="使用工作 Email 登入你的工作空間" />

      <form onSubmit={handleSubmit} className="space-y-5" data-staff-login>
        <div className="space-y-2">
          <label htmlFor="email" className="block text-sm font-medium text-text">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-text outline-none transition-colors placeholder:text-secondary-text/70 focus:border-primary"
            placeholder="請輸入 Email"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="block text-sm font-medium text-text">
            密碼
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-text outline-none transition-colors placeholder:text-secondary-text/70 focus:border-primary"
            placeholder="請輸入密碼"
          />
        </div>

        {!supabaseReady || errorKind === "config" ? (
          <AuthAlert
            tone="error"
            title="目前無法登入"
            description="登入服務尚未設定，請聯絡系統管理員。"
          />
        ) : null}
        {errorKind === "credentials" ? (
          <AuthAlert
            tone="error"
            title="Email 或密碼不正確"
            description="請確認後重新輸入，或使用忘記密碼。"
          />
        ) : null}
        {errorKind === "network" ? (
          <AuthAlert
            tone="error"
            title="目前無法連線"
            description="請檢查網路後再試一次。"
          />
        ) : null}

        <p className="text-xs leading-relaxed text-secondary-text">
          登入狀態會安全保留在此裝置。
        </p>

        <Button type="submit" fullWidth size="lg" disabled={submitting}>
          {submitting ? "登入中…" : "登入"}
        </Button>

        <div className="text-center">
          <button
            type="button"
            className="min-h-11 px-2 text-sm text-secondary-text transition-colors hover:text-primary"
            onClick={() => router.push("/staff/auth/forgot-password")}
          >
            忘記密碼
          </button>
        </div>
      </form>
    </AuthCard>
  );
}
