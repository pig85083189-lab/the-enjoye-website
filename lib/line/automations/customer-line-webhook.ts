/**
 * Customer bind / consent / unsubscribe / block after an already-verified webhook.
 * Bind never implies reminder consent. Never accepts a client-supplied userId.
 * Never Push / Broadcast.
 */

import {
  evaluateCustomerBindCode,
  packCustomerBindIdentity,
  selectCustomerConsentEvent,
  selectCustomerUnbindEvent,
  selectCustomerUnfollowEvent,
  selectCustomerUnsubscribeEvent,
} from "@/lib/line/automations/customer-line-bind";
import { extractLineWebhookTextEvents, type LineWebhookTextEvent } from "@/lib/line/line-bind";

export type CustomerWebhookAutomationResult = {
  bound: boolean;
  consented: boolean;
  unsubscribed: boolean;
  blocked: boolean;
  unbound: boolean;
  duplicate: boolean;
};

const EMPTY_CUSTOMER_WEBHOOK: CustomerWebhookAutomationResult = {
  bound: false,
  consented: false,
  unsubscribed: false,
  blocked: false,
  unbound: false,
  duplicate: false,
};

async function acceptCustomerWebhookEvent(input: {
  event: LineWebhookTextEvent;
  claimEvent?: (eventId: string) => Promise<{ duplicate: boolean }>;
}): Promise<"accept" | "duplicate"> {
  const eventId = input.event.eventId?.trim() ?? "";
  if (eventId && input.claimEvent) {
    const claimed = await input.claimEvent(eventId);
    if (claimed.duplicate) return "duplicate";
    return "accept";
  }
  if (input.event.isRedelivery === true) return "duplicate";
  return "accept";
}

export async function processLineWebhookCustomerAutomation(input: {
  organizationId: string;
  rawBody: string;
  encryptUserId: (userId: string) => { cipher: string; keyId: string } | null;
  consumeBind: (input: {
    organizationId: string;
    code: string;
    cipher: string;
    hash: string;
    hint: string;
    keyId: string;
  }) => Promise<{ bound: boolean }>;
  setConsent?: (hash: string, optIn: boolean) => Promise<{ ok?: boolean } | void>;
  markUnsubscribed: (hash: string) => Promise<void>;
  markUnbound: (hash: string) => Promise<void>;
  markBlocked: (hash: string) => Promise<void>;
  claimEvent?: (eventId: string) => Promise<{ duplicate: boolean }>;
}): Promise<CustomerWebhookAutomationResult> {
  if (typeof window !== "undefined") {
    throw new Error("LINE customer webhook cannot run in the browser");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    return EMPTY_CUSTOMER_WEBHOOK;
  }
  const events = extractLineWebhookTextEvents(payload);

  const unfollow = selectCustomerUnfollowEvent(events);
  if (unfollow) {
    const event = events.find(
      (row) =>
        row.userId === unfollow.userId &&
        (row.eventType === "unfollow" || row.eventType === "blocked"),
    );
    if (event && (await acceptCustomerWebhookEvent({ event, claimEvent: input.claimEvent })) === "duplicate") {
      return { ...EMPTY_CUSTOMER_WEBHOOK, duplicate: true };
    }
    const packed = input.encryptUserId(unfollow.userId);
    if (packed) {
      const identity = packCustomerBindIdentity({
        organizationId: input.organizationId,
        userId: unfollow.userId,
        cipher: packed.cipher,
        keyId: packed.keyId,
      });
      await input.markBlocked(identity.hash);
    }
    return { ...EMPTY_CUSTOMER_WEBHOOK, blocked: true };
  }

  const unbind = selectCustomerUnbindEvent(events);
  if (unbind) {
    const event = events.find((row) => row.userId === unbind.userId && row.text);
    if (event && (await acceptCustomerWebhookEvent({ event, claimEvent: input.claimEvent })) === "duplicate") {
      return { ...EMPTY_CUSTOMER_WEBHOOK, duplicate: true };
    }
    const packed = input.encryptUserId(unbind.userId);
    if (packed) {
      const identity = packCustomerBindIdentity({
        organizationId: input.organizationId,
        userId: unbind.userId,
        cipher: packed.cipher,
        keyId: packed.keyId,
      });
      await input.markUnbound(identity.hash);
    }
    return { ...EMPTY_CUSTOMER_WEBHOOK, unbound: true };
  }

  const unsub = selectCustomerUnsubscribeEvent(events);
  if (unsub) {
    const event = events.find((row) => row.userId === unsub.userId && row.text);
    if (event && (await acceptCustomerWebhookEvent({ event, claimEvent: input.claimEvent })) === "duplicate") {
      return { ...EMPTY_CUSTOMER_WEBHOOK, duplicate: true };
    }
    const packed = input.encryptUserId(unsub.userId);
    if (packed) {
      const identity = packCustomerBindIdentity({
        organizationId: input.organizationId,
        userId: unsub.userId,
        cipher: packed.cipher,
        keyId: packed.keyId,
      });
      await input.markUnsubscribed(identity.hash);
    }
    return { ...EMPTY_CUSTOMER_WEBHOOK, unsubscribed: true };
  }

  const consent = selectCustomerConsentEvent(events);
  if (consent) {
    const event = events.find((row) => row.userId === consent.userId && row.text);
    if (event && (await acceptCustomerWebhookEvent({ event, claimEvent: input.claimEvent })) === "duplicate") {
      return { ...EMPTY_CUSTOMER_WEBHOOK, duplicate: true };
    }
    const packed = input.encryptUserId(consent.userId);
    if (packed && input.setConsent) {
      const identity = packCustomerBindIdentity({
        organizationId: input.organizationId,
        userId: consent.userId,
        cipher: packed.cipher,
        keyId: packed.keyId,
      });
      if (identity.hash) {
        await input.setConsent(identity.hash, true);
        return { ...EMPTY_CUSTOMER_WEBHOOK, consented: true };
      }
    }
    return EMPTY_CUSTOMER_WEBHOOK;
  }

  const bindEvent = events.find((event) => evaluateCustomerBindCode(event.text));
  const code = bindEvent ? evaluateCustomerBindCode(bindEvent.text) : null;
  if (!bindEvent?.userId || !code) {
    return EMPTY_CUSTOMER_WEBHOOK;
  }
  const packed = input.encryptUserId(bindEvent.userId);
  if (!packed) return EMPTY_CUSTOMER_WEBHOOK;
  const identity = packCustomerBindIdentity({
    organizationId: input.organizationId,
    userId: bindEvent.userId,
    cipher: packed.cipher,
    keyId: packed.keyId,
  });
  if (!identity.hash) return EMPTY_CUSTOMER_WEBHOOK;
  const consumed = await input.consumeBind({
    organizationId: input.organizationId,
    code,
    cipher: identity.cipher,
    hash: identity.hash,
    hint: identity.hint,
    keyId: identity.keyId,
  });
  return { ...EMPTY_CUSTOMER_WEBHOOK, bound: consumed.bound };
}
