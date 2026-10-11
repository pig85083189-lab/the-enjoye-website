import { NextResponse, type NextRequest } from "next/server";
import { evaluateLineWebhookHostAccess } from "@/lib/line/line-webhook-host";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const hostGate = evaluateLineWebhookHostAccess({ host, pathname });
  if (!hostGate.allow) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
  if (pathname === "/staff" || pathname.startsWith("/staff/")) {
    return updateSession(request);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/staff",
    "/staff/:path*",
    "/api/line/webhook",
    "/api/line/webhook/:path*",
    "/((?!_next/static|_next/image|_next/data|favicon.ico|.*\\..*).*)",
  ],
};
