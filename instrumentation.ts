export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { reconfirmBookingSource } = await import("@/lib/commerce/booking-source-reconfirm");
  await Promise.race([
    reconfirmBookingSource(),
    new Promise((resolve) => setTimeout(resolve, 12000)),
  ]);
}
