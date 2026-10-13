/**
 * Customer bind / unsubscribe / block after an already-verified webhook.
 * Never accepts a client-supplied userId. Never Push / Broadcast.
 */

import {
  evaluateCustomerBindCode,
  packCustomerBindIdentity,
  selectCustomerUnbindEvent,
  selectCustomerUnfollowEvent,
  selectCustomerUnsubscribeEvent,
} from "@/lib/line/automations/customer-line-bind";
import { extractLineWebhookTextEvents } from "@/lib/line/line-bind";

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
  markUnsubscribed: (hash: string) => Promise<void>;
  markUnbound: (hash: string) => Promise<void>;
  markBlocked: (hash: string) => Promise<void>;
}): Promise<{ bound: boolean; unsubscribed: boolean; blocked: boolean; unbound: boolean }> {
  if (typeof window !== "undefined") {
    throw new Error("LINE customer webhook cannot run in the browser");
  }
  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody) as unknown;
  } catch {
    return { bound: false, unsubscribed: false, blocked: false, unbound: false };
  }
  const events = extractLineWebhookTextEvents(payload);
  const unfollow = selectCustomerUnfollowEvent(events);
  if (unfollow) {
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
    return { bound: false, unsubscribed: false, blocked: true, unbound: false };
  }
  const unbind = selectCustomerUnbindEvent(events);
  if (unbind) {
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
    return { bound: false, unsubscribed: false, blocked: false, unbound: true };
  }
  const unsub = selectCustomerUnsubscribeEvent(events);
  if (unsub) {
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
    return { bound: false, unsubscribed: true, blocked: false, unbound: false };
  }
  const bindEvent = events.find((event) => evaluateCustomerBindCode(event.text));
  const code = bindEvent ? evaluateCustomerBindCode(bindEvent.text) : null;
  if (!bindEvent?.userId || !code) {
    return { bound: false, unsubscribed: false, blocked: false, unbound: false };
  }
  const packed = input.encryptUserId(bindEvent.userId);
  if (!packed) return { bound: false, unsubscribed: false, blocked: false, unbound: false };
  const identity = packCustomerBindIdentity({
    organizationId: input.organizationId,
    userId: bindEvent.userId,
    cipher: packed.cipher,
    keyId: packed.keyId,
  });
  const consumed = await input.consumeBind({
    organizationId: input.organizationId,
    code,
    cipher: identity.cipher,
    hash: identity.hash,
    hint: identity.hint,
    keyId: identity.keyId,
  });
  return { bound: consumed.bound, unsubscribed: false, blocked: false, unbound: false };
}
