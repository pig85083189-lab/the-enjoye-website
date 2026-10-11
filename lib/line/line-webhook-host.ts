import { LINE_WEBHOOK_HOST_ENV } from "@/lib/line/line-flag";
import { assertLineWebhookPublicToken } from "@/lib/line/line-webhook-url";

export function normalizeRequestHost(host: string | null | undefined): string {
  return (host ?? "").trim().toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
}

export function lineWebhookOnlyHost(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): string {
  return normalizeRequestHost(env[LINE_WEBHOOK_HOST_ENV]);
}

export function isLineWebhookOnlyHost(
  host: string | null | undefined,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): boolean {
  const expected = lineWebhookOnlyHost(env);
  const incoming = normalizeRequestHost(host);
  return Boolean(expected && incoming && expected === incoming);
}

export function isLineWebhookPublicPath(pathname: string | null | undefined): boolean {
  const path = (pathname ?? "").split("?")[0];
  return path === "/api/line/webhook" || path.startsWith("/api/line/webhook/");
}

export function evaluateLineWebhookHostAccess(input: {
  host: string | null | undefined;
  pathname: string;
  env?: NodeJS.Dict<string>;
}): { allow: boolean; reason?: "not_webhook_path" | "wrong_host" } {
  const env = input.env ?? (typeof process !== "undefined" ? process.env : {});
  const webhookHost = lineWebhookOnlyHost(env);
  if (!webhookHost) {
    return { allow: true };
  }
  if (isLineWebhookOnlyHost(input.host, env)) {
    return isLineWebhookPublicPath(input.pathname)
      ? { allow: true }
      : { allow: false, reason: "not_webhook_path" };
  }
  if (isLineWebhookPublicPath(input.pathname)) {
    return { allow: false, reason: "wrong_host" };
  }
  return { allow: true };
}

export function evaluateLineWebhookAdmission(input: {
  organizationId: string | null | undefined;
  publicToken: string | null | undefined;
  host?: string | null;
  pathname?: string;
  env?: NodeJS.Dict<string>;
}): { allow: boolean; reason?: "invalid_input" | "wrong_host" | "not_webhook_path" } {
  if (!input.organizationId?.startsWith("org-") || !assertLineWebhookPublicToken(input.publicToken)) {
    return { allow: false, reason: "invalid_input" };
  }
  if (input.pathname || input.host) {
    const hostGate = evaluateLineWebhookHostAccess({
      host: input.host,
      pathname: input.pathname ?? `/api/line/webhook/${input.organizationId}/${input.publicToken}`,
      env: input.env,
    });
    if (!hostGate.allow) {
      return { allow: false, reason: hostGate.reason };
    }
  }
  return { allow: true };
}
