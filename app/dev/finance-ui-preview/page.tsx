import { connection } from "next/server";
import { notFound } from "next/navigation";
import { FinanceVisualPreview } from "@/features/finance/FinanceVisualPreview";
import { isDemoSeedEnabled } from "@/lib/persistence/demo-firewall";

export default async function FinanceUiPreviewPage({
  searchParams,
}: {
  searchParams: Promise<{ surface?: string }>;
}) {
  await connection();
  if (!isDemoSeedEnabled()) notFound();
  const params = await searchParams;
  const surface =
    params.surface === "income" || params.surface === "expenses" || params.surface === "reports"
      ? params.surface
      : "dashboard";
  return <FinanceVisualPreview surface={surface} />;
}

