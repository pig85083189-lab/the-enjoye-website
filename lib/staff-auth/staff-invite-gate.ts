/**
 * Session gate after invite / before membership bind.
 * Logged-in unbound users cannot enter the staff workspace.
 */

export type StaffSessionGate =
  | "login"
  | "setup_password"
  | "access_unavailable"
  | "ok";

export const STAFF_SETUP_PASSWORD_HREF = "/staff/auth/setup-password";
export const STAFF_ACCESS_UNAVAILABLE_HREF = "/staff/auth/access-unavailable";
export const STAFF_LOGIN_HREF = "/staff/login";
export const STAFF_TODAY_HREF = "/staff/today";

export function resolveStaffSessionGate(input: {
  authenticated: boolean;
  boundActiveMembership: boolean;
  pendingInviteForAuthUser: boolean;
}): StaffSessionGate {
  if (!input.authenticated) return "login";
  if (input.boundActiveMembership) return "ok";
  if (input.pendingInviteForAuthUser) return "setup_password";
  return "access_unavailable";
}

export function isStaffAuthUtilityPath(pathname: string): boolean {
  return (
    pathname === "/staff/login" ||
    pathname === "/staff/auth" ||
    pathname.startsWith("/staff/auth/")
  );
}

export function isStaffWorkspacePath(pathname: string): boolean {
  if (!pathname.startsWith("/staff")) return false;
  if (pathname === "/staff") return false;
  return !isStaffAuthUtilityPath(pathname);
}

export function resolveStaffSessionRedirect(input: {
  pathname: string;
  gate: StaffSessionGate;
}): string | null {
  const { pathname, gate } = input;

  if (gate === "login" && isStaffWorkspacePath(pathname)) {
    return STAFF_LOGIN_HREF;
  }

  if (gate === "setup_password") {
    if (pathname === STAFF_SETUP_PASSWORD_HREF) return null;
    if (isStaffWorkspacePath(pathname) || pathname === STAFF_LOGIN_HREF) {
      return STAFF_SETUP_PASSWORD_HREF;
    }
    return null;
  }

  if (gate === "access_unavailable") {
    if (pathname === STAFF_ACCESS_UNAVAILABLE_HREF) return null;
    if (isStaffWorkspacePath(pathname) || pathname === STAFF_LOGIN_HREF) {
      return STAFF_ACCESS_UNAVAILABLE_HREF;
    }
    return null;
  }

  if (gate === "ok" && pathname === STAFF_LOGIN_HREF) {
    return STAFF_TODAY_HREF;
  }

  return null;
}
