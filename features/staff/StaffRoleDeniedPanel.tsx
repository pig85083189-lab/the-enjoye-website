"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function StaffRoleDeniedPanel() {
  const router = useRouter();

  useEffect(() => {
    router.replace("/staff/today");
  }, [router]);

  return (
    <div
      className="flex min-h-[50vh] flex-col items-center justify-center gap-3 px-6 text-center"
      data-staff-role-denied
    >
      <p className="text-lg font-semibold text-text">沒有權限查看這個頁面</p>
      <p className="max-w-sm text-sm leading-relaxed text-secondary-text">
        這個頁面僅限店長或被授權的角色使用。正在返回今日工作台。
      </p>
      <Button
        type="button"
        variant="secondary"
        className="mt-2 min-h-11 px-5"
        onClick={() => router.replace("/staff/today")}
      >
        返回今日
      </Button>
    </div>
  );
}
