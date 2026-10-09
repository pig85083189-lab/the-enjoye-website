"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { AuthAlert, AuthBrand, AuthCard, AuthShell } from "@/features/auth/AuthShell";
import { staffAuthCallbackHref } from "@/lib/staff-auth/staff-auth-callback";
import { createBrowserClientOrNull } from "@/lib/supabase/client";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">(
    "idle",
  );
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("loading");
    setTitle("");
    setDescription("");
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
    const redirectTo = `${window.location.origin}${staffAuthCallbackHref("recovery")}`;
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
        redirectTo,
      });
      if (error) {
        setStatus("error");
        setTitle("目前無法寄送重設信件");
        setDescription(error.message || "請稍後再試，或聯絡系統管理員。");
        return;
      }
      setStatus("success");
      setTitle("重設信件已寄出");
      setDescription(
        "請用同一個瀏覽器開啟信件連結。這不會登出你目前的其他工作階段。",
      );
    } catch {
      setStatus("error");
      setTitle("目前無法連線");
      setDescription("請檢查網路後再試一次。");
    }
  }

  return (
    <AuthShell>
      <AuthCard data-staff-forgot-password>
        <AuthBrand title="忘記密碼" description="輸入工作 Email，我們會寄送重設連結。" />
        <form onSubmit={handleSubmit} className="space-y-4">
          <label className="block text-sm font-medium text-text">
            Email
            <input
              type="email"
              required
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
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
          <Button type="submit" fullWidth size="lg" disabled={status === "loading"}>
            {status === "loading" ? "寄送中…" : "寄送重設信件"}
          </Button>
          <button
            type="button"
            className="flex min-h-11 w-full items-center justify-center text-sm text-secondary-text"
            onClick={() => router.push("/staff/login")}
          >
            返回登入
          </button>
        </form>
      </AuthCard>
    </AuthShell>
  );
}
