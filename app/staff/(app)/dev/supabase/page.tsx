import { Card } from "@/components/ui/Card";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type ConnectionResult =
  | {
      ok: true;
      hasSession: boolean;
    }
  | {
      ok: false;
      message: string;
    };

async function testSupabaseConnection(): Promise<ConnectionResult> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return {
        ok: false,
        message: error.message || "Supabase auth request failed.",
      };
    }

    return {
      ok: true,
      hasSession: Boolean(data.session),
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unexpected connection error.";

    // Never surface secrets — only safe Error.message from our env helper / client
    return {
      ok: false,
      message,
    };
  }
}

export default async function SupabaseDevPage() {
  const result = await testSupabaseConnection();

  return (
    <div className="mx-auto w-full max-w-2xl">
      <header className="mb-6">
        <p className="text-[11px] tracking-[0.18em] text-secondary-text">BEAUTY OS</p>
        <h1 className="mt-2 text-2xl font-semibold text-text">Supabase Connection</h1>
        <p className="mt-2 text-sm text-secondary-text">
          Development-only foundation check（不查詢任何業務資料表）
        </p>
      </header>

      <Card padding="lg">
        <p className="text-sm text-secondary-text">Connection Status</p>
        {result.ok ? (
          <p className="mt-2 text-2xl font-semibold text-success">Connected</p>
        ) : (
          <>
            <p className="mt-2 text-2xl font-semibold text-danger">Connection Failed</p>
            <p
              role="alert"
              className="mt-3 rounded-2xl bg-[#F7E8E8] px-4 py-3 text-sm text-[#B15B5B]"
            >
              {result.message}
            </p>
          </>
        )}

        <dl className="mt-6 space-y-3 border-t border-border pt-5 text-[15px]">
          <div className="flex justify-between gap-4">
            <dt className="text-secondary-text">Project</dt>
            <dd className="font-medium text-text">the-enjoye-beauty-os</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-secondary-text">Environment</dt>
            <dd className="font-medium text-text">Development</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-secondary-text">Authentication</dt>
            <dd className="font-medium text-text">Not configured yet</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-secondary-text">Database Schema</dt>
            <dd className="font-medium text-text">Not created yet</dd>
          </div>
          {result.ok ? (
            <div className="flex justify-between gap-4">
              <dt className="text-secondary-text">Session</dt>
              <dd className="font-medium text-text">
                {result.hasSession ? "Present" : "None (expected)"}
              </dd>
            </div>
          ) : null}
        </dl>
      </Card>

      {result.ok ? (
        <p className="mt-6 text-[15px] leading-relaxed text-secondary-text">
          Supabase 基礎連線已建立。下一階段將建立 Beauty OS Database Schema。
        </p>
      ) : (
        <p className="mt-6 text-[15px] leading-relaxed text-secondary-text">
          請確認本機 `.env.local` 已設定 URL 與 Publishable Key，然後重新整理此頁。
        </p>
      )}
    </div>
  );
}
