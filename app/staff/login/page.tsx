import { LoginForm } from "@/features/auth/LoginForm";

export default function StaffLoginPage() {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-background px-5 py-12">
      <div
        className="pointer-events-none absolute inset-0 opacity-60"
        style={{
          background:
            "radial-gradient(ellipse at top, rgba(245,229,227,0.7) 0%, transparent 55%)",
        }}
        aria-hidden
      />
      <div className="relative z-10 flex w-full flex-col items-center">
        <LoginForm />
        <p className="mt-10 max-w-sm text-center text-sm leading-relaxed text-secondary-text">
          每一次的相遇，都是讓世界更美一點的機會。
        </p>
      </div>
    </div>
  );
}
