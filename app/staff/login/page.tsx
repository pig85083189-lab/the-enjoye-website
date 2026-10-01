import { Suspense } from "react";
import { LoginForm } from "@/features/auth/LoginForm";
import { AuthShell } from "@/features/auth/AuthShell";

function LoginFallback() {
  return (
    <div className="flex min-h-40 items-center justify-center text-sm text-secondary-text">
      載入中…
    </div>
  );
}

export default function StaffLoginPage() {
  return (
    <AuthShell
      footer={
        <p className="mt-10 max-w-sm text-center text-sm leading-relaxed text-secondary-text">
          每一次的相遇，都是讓世界更美一點的機會。
        </p>
      }
    >
      <Suspense fallback={<LoginFallback />}>
        <LoginForm />
      </Suspense>
    </AuthShell>
  );
}
