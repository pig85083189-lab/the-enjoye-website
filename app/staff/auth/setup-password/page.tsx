"use client";

import { Suspense, useMemo, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { AuthAlert, AuthBrand, AuthCard, AuthShell } from "@/features/auth/AuthShell";
import { completeStaffPasswordSetupAction } from "@/lib/staff-auth/actions";
import { staffSetupPasswordLinkErrorCopy } from "@/lib/staff-auth/staff-auth-callback";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";

function SetupPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const linkError = searchParams.get("error");
  const linkFlow = searchParams.get("flow");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const linkErrorCopy = useMemo(
    () => staffSetupPasswordLinkErrorCopy({ error: linkError, flow: linkFlow }),
    [linkError, linkFlow],
  );
  const expired = Boolean(linkErrorCopy);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    expired ? "error" : "idle",
  );
  const [title, setTitle] = useState(linkErrorCopy?.title ?? "");
  const [description, setDescription] = useState(linkErrorCopy?.description ?? "");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTitle("");
    setDescription("");
    if (password.length < 8) {
      setStatus("error");
      setTitle("目前無法設定密碼");
      setDescription("密碼至少需要 8 個字元。");
      return;
    }
    if (password !== confirm) {
      setStatus("error");
      setTitle("目前無法設定密碼");
      setDescription("兩次輸入的密碼不一致。");
      return;
    }
    if (!tryGetSupabaseEnv()) {
      setStatus("error");
      setTitle("目前無法登入");
      setDescription("登入服務尚未設定，請聯絡系統管理員。");
      return;
    }
    const supabase = createBrowserClientOrNull();
    if (!supabase) {
      setStatus("error");
      setTitle("目前無法登入");
      setDescription("登入服務尚未設定，請聯絡系統管理員。");
      return;
    }
    setStatus("loading");
    try {
      const { data: userData } = await supabase.auth.getUser();
      if (!userData.user) {
        const unauthenticated = linkFlow
          ? staffSetupPasswordLinkErrorCopy({
              error: "invalid",
              flow: linkFlow,
            })
          : null;
        setStatus("error");
        setTitle(unauthenticated?.title ?? "這個連結已失效");
        setDescription(
          unauthenticated?.description ??
            "目前尚未登入，無法設定密碼。請重新取得重設或邀請連結。",
        );
        return;
      }
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setStatus("error");
        setTitle("目前無法設定密碼");
        setDescription(error.message || "請重新取得邀請或重設信。");
        return;
      }
      setPassword("");
      setConfirm("");
      const completed = await completeStaffPasswordSetupAction();
      if (!completed.ok) {
        setStatus("error");
        setTitle("密碼已儲存，但尚未取得工作台權限");
        setDescription(completed.message);
        if (
          completed.intent === "unavailable" ||
          completed.reason === "expired" ||
          completed.reason === "invalid_invite"
        ) {
          router.replace("/staff/auth/access-unavailable");
        }
        return;
      }
      setStatus("success");
      setTitle("密碼已設定");
      setDescription(
        completed.intent === "recovery" ? "正在返回工作台。" : "正在進入工作台。",
      );
      router.replace("/staff/today");
      router.refresh();
    } catch {
      setStatus("error");
      setTitle("目前無法連線");
      setDescription("請檢查網路後再試一次。");
    }
  }

  return (
    <AuthShell>
      <AuthCard data-staff-setup-password>
        <AuthBrand
          title="設定密碼"
          description="請設定自己的登入密碼。密碼只會存在 Supabase Auth，不會寫進 Beauty OS 資料表。"
        />
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-text">
            新密碼
            <input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary"
            />
          </label>
          <label className="block text-sm font-medium text-text">
            再次輸入密碼
            <input
              type="password"
              autoComplete="new-password"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              className="mt-2 h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] outline-none focus:border-primary"
            />
          </label>
          {title ? (
            <AuthAlert
              tone={status === "success" ? "success" : "error"}
              title={title}
              description={description}
            />
          ) : null}
          <Button
            type="submit"
            fullWidth
            size="lg"
            disabled={status === "loading" || expired}
          >
            {status === "loading" ? "儲存中…" : "儲存密碼"}
          </Button>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center text-sm text-secondary-text"
            onClick={() => router.push("/staff/login")}
          >
            返回登入
          </button>
          {linkErrorCopy ? (
            <p className="text-center text-xs leading-relaxed text-secondary-text">
              {linkErrorCopy.hint}
            </p>
          ) : null}
        </form>
      </AuthCard>
    </AuthShell>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background text-secondary-text">
          載入中…
        </div>
      }
    >
      <SetupPasswordForm />
    </Suspense>
  );
}
