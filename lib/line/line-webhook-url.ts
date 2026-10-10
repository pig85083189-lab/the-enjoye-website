import { randomBytes } from "node:crypto";
import { LINE_WEBHOOK_BASE_URL_ENV, LINE_WEBHOOK_HOST_ENV } from "@/lib/line/line-flag";
import { isLineWebhookPublicToken } from "@/lib/line/line-bind";

export function createLineWebhookPublicToken(): string {
  if (typeof window !== "undefined") {
    throw new Error("LINE webhook token cannot be created in the browser");
  }
  return randomBytes(32).toString("base64url");
}

export function lineWebhookPublicPath(organizationId: string, token: string): string {
  return `/api/line/webhook/${encodeURIComponent(organizationId)}/${encodeURIComponent(token)}`;
}

export function lineWebhookPublicBaseUrl(
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): string {
  const explicit = (env[LINE_WEBHOOK_BASE_URL_ENV] ?? "").trim().replace(/\/$/, "");
  if (explicit) return explicit;
  const webhookHost = (env[LINE_WEBHOOK_HOST_ENV] ?? "").trim().replace(/^https?:\/\//, "");
  if (webhookHost) return `https://${webhookHost.replace(/\/$/, "")}`;
  const branch = (env.VERCEL_BRANCH_URL ?? "").trim().replace(/^https?:\/\//, "");
  if (branch) return `https://${branch}`;
  const vercel = (env.VERCEL_URL ?? "").trim().replace(/^https?:\/\//, "");
  if (vercel) return `https://${vercel}`;
  return "";
}

export function lineWebhookPublicUrl(
  organizationId: string,
  token: string,
  env: NodeJS.Dict<string> = typeof process !== "undefined" ? process.env : {},
): string {
  const base = lineWebhookPublicBaseUrl(env);
  const path = lineWebhookPublicPath(organizationId, token);
  return base ? `${base}${path}` : path;
}

export function assertLineWebhookPublicToken(token: string | null | undefined): string | null {
  const value = token?.trim() ?? "";
  return isLineWebhookPublicToken(value) ? value : null;
}
