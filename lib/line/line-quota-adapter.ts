/**
 * Server-only LINE quota adapter.
 * Uses GET /v2/bot/message/quota and /quota/consumption.
 * Never broadcasts. Never logs tokens. Unknown beats a fabricated remaining count.
 */

import {
  LINE_API_ORIGIN,
  LINE_QUOTA_CONSUMPTION_PATH,
  LINE_QUOTA_PATH,
} from "@/lib/line/line-command";
import { describeLineQuota, unknownLineQuota } from "@/lib/line/line-quota";
import type { LineQuotaPublic } from "@/lib/line/line-types";

type QuotaResponse = {
  type?: string;
  value?: number;
};

type ConsumptionResponse = {
  totalUsage?: number;
};

async function readJson<T>(
  fetchImpl: typeof fetch,
  path: string,
  accessToken: string,
): Promise<T | null> {
  const response = await fetchImpl(`${LINE_API_ORIGIN}${path}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) return null;
  return (await response.json()) as T;
}

export async function fetchLineMessageQuota(input: {
  accessToken: string;
  fetchImpl?: typeof fetch;
}): Promise<LineQuotaPublic> {
  if (typeof window !== "undefined") {
    throw new Error("LINE quota adapter cannot run in the browser");
  }
  const token = input.accessToken.trim();
  if (!token) return unknownLineQuota("尚未設定 Channel Access Token");
  const fetchImpl = input.fetchImpl ?? fetch;
  try {
    const [quota, consumption] = await Promise.all([
      readJson<QuotaResponse>(fetchImpl, LINE_QUOTA_PATH, token),
      readJson<ConsumptionResponse>(fetchImpl, LINE_QUOTA_CONSUMPTION_PATH, token),
    ]);
    if (!quota) return unknownLineQuota();
    const type = quota.type === "none" || quota.type === "limited" ? quota.type : null;
    return describeLineQuota({
      type,
      limit: typeof quota.value === "number" ? quota.value : null,
      usage: typeof consumption?.totalUsage === "number" ? consumption.totalUsage : null,
    });
  } catch {
    return unknownLineQuota();
  }
}
