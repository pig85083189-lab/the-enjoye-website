import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { tryGetSupabaseEnv } from "@/lib/supabase/env";

const PUBLIC_STAFF_PREFIXES = [
  "/staff/login",
  "/staff/auth",
];

function isPublicStaffPath(pathname: string): boolean {
  if (pathname === "/staff") return true;
  return PUBLIC_STAFF_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function isProtectedStaffPath(pathname: string): boolean {
  if (!pathname.startsWith("/staff")) return false;
  return !isPublicStaffPath(pathname);
}

/**
 * Refresh Supabase cookies and gate /staff/* with auth.getUser().
 */
export async function updateSession(request: NextRequest) {
  const env = tryGetSupabaseEnv();
  const pathname = request.nextUrl.pathname;

  if (!env) {
    if (isProtectedStaffPath(pathname)) {
      const url = request.nextUrl.clone();
      url.pathname = "/staff/login";
      url.searchParams.set("next", pathname);
      return NextResponse.redirect(url);
    }
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          supabaseResponse.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (isProtectedStaffPath(pathname) && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff/login";
    url.searchParams.set("next", pathname);
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return redirect;
  }

  if (pathname === "/staff/login" && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/staff/today";
    url.search = "";
    const redirect = NextResponse.redirect(url);
    supabaseResponse.cookies.getAll().forEach((cookie) => {
      redirect.cookies.set(cookie.name, cookie.value);
    });
    return redirect;
  }

  return supabaseResponse;
}
