"use client";

import { useEffect, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import {
  getSessionRaw,
  saveSession,
  subscribeAuth,
  validateCredentials,
} from "@/lib/auth";

export function LoginForm() {
  const router = useRouter();
  const sessionRaw = useSyncExternalStore(subscribeAuth, getSessionRaw, () => null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (sessionRaw) {
      router.replace("/staff/today");
    }
  }, [sessionRaw, router]);

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSubmitting(true);

    const staff = validateCredentials(username, password);
    if (!staff) {
      setError("帳號或密碼不正確，請再試一次。");
      setSubmitting(false);
      return;
    }

    saveSession(staff, remember);
    router.push("/staff/today");
  }

  return (
    <Card padding="lg" className="w-full max-w-md">
      <div className="mb-8 text-center">
        <p className="text-[11px] tracking-[0.22em] text-secondary-text">BEAUTY OS</p>
        <h1 className="mt-2 font-display text-3xl tracking-[0.16em] text-primary sm:text-4xl">
          Beauty OS
        </h1>
        <p className="mt-2 text-xs tracking-[0.18em] text-secondary-text">
          美容師工作台 · Multi-tenant Prototype
        </p>
        <p className="mt-5 text-base font-medium text-text">登入後選擇店家工作</p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div className="space-y-2">
          <label htmlFor="username" className="block text-sm font-medium text-text">
            帳號
          </label>
          <input
            id="username"
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            className="h-12 w-full rounded-2xl border border-border bg-background px-4 text-[15px] text-text outline-none transition-colors placeholder:text-secondary-text/70 focus:border-primary"
            placeholder="請輸入帳號"
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

        {error ? (
          <p
            role="alert"
            className="rounded-2xl bg-[#F7E8E8] px-4 py-3 text-sm leading-relaxed text-[#B15B5B]"
          >
            {error}
          </p>
        ) : null}

        <label className="flex min-h-11 items-center gap-3 text-sm text-secondary-text">
          <input
            type="checkbox"
            checked={remember}
            onChange={(event) => setRemember(event.target.checked)}
            className="h-4 w-4 rounded border-border accent-primary"
          />
          記住我
        </label>

        <Button type="submit" fullWidth size="lg" disabled={submitting}>
          {submitting ? "登入中…" : "登入"}
        </Button>

        <div className="text-center">
          <button
            type="button"
            className="min-h-11 px-2 text-sm text-secondary-text transition-colors hover:text-primary"
            onClick={() => setError("忘記密碼功能即將推出，請先使用 Demo 帳號登入。")}
          >
            忘記密碼
          </button>
        </div>
      </form>

      <p className="mt-6 rounded-2xl bg-primary-light/60 px-4 py-3 text-center text-xs leading-relaxed text-secondary-text">
        Demo：yizhen / 123456
      </p>
    </Card>
  );
}
