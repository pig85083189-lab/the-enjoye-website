export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (process.env.VERCEL_ENV !== "production") return;
  const probe = import("@/lib/commerce/booking-finance-identity-probe").then(({ probeBookingFinanceIdentity }) =>
    probeBookingFinanceIdentity("e06709d5-893f-4be1-8d83-b3d666a9257c"),
  );
  const report = await Promise.race([
    probe,
    new Promise<Record<string, unknown>>((resolve) => {
      setTimeout(() => resolve({ ok: false, code: "PROBE_TIMEOUT" }), 12000);
    }),
  ]);
  console.info("[cross-db-identity-report]", JSON.stringify(report));
}
