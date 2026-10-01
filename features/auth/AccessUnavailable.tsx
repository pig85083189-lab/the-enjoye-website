"use client";

import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { signOutStaff } from "@/lib/staff-auth/sign-out";

export function AccessUnavailablePanel() {
  const router = useRouter();

  return (
    <div
      className="flex min-h-dvh flex-col items-center justify-center gap-3 overflow-x-hidden bg-background px-6 text-center"
      data-staff-access-unavailable
    >
      <p className="text-lg font-semibold text-text">Access Unavailable</p>
      <p className="max-w-sm text-sm leading-relaxed text-secondary-text">
        此帳號目前沒有可使用的店家
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-4 min-h-11 px-5"
        onClick={async () => {
          await signOutStaff();
          router.replace("/staff/login");
        }}
      >
        登出
      </Button>
    </div>
  );
}
