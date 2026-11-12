import Link from "next/link";
import { getServerStaffAuthUser } from "@/lib/staff-auth/server";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/**
 * Isolated staff-only entry point. This page deliberately performs no
 * customer mutations until the LINE member consent + staff approval
 * transaction is implemented and tested against staging.
 */
export default async function CustomerLineBindingPage() {
  const staff = await getServerStaffAuthUser();
  if (!staff) redirect("/staff/login");
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-6">
      <Link href="/staff/customers" className="text-sm underline">返回顧客列表</Link>
      <header className="space-y-2">
        <h1 className="text-2xl font-semibold">LINE 會員資料綁定</h1>
        <p className="text-sm text-secondary-text">將已完成身分核對的店內顧客與 LINE 會員關聯，保留原有顧客與預約資料。</p>
      </header>
      <section className="rounded-xl border p-5 space-y-3" aria-label="綁定安全說明">
        <h2 className="font-medium">綁定流程</h2>
        <ol className="list-decimal space-y-2 pl-5 text-sm">
          <li>顧客使用 LINE 登入會員網站，取得本人確認的綁定請求。</li>
          <li>店員核對顧客身分與店內資料，確認屬於同一人。</li>
          <li>系統檢查是否已被其他 LINE 會員認領，才允許核准。</li>
          <li>綁定完成後，會員中心顯示經驗證的店內預約紀錄。</li>
        </ol>
        <p role="status" className="text-sm">目前為安全預覽。核准操作尚未開放，任何顧客資料都不會被變更。</p>
      </section>
    </main>
  );
}
