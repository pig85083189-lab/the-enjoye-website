/**
 * Mock LINE Messaging adapter for the shared delivery engine.
 * Never calls fetch, never opens a LINE Messaging HTTP origin, never opens send flags.
 * Existing Broadcast / Test Push adapters stay untouched.
 */
import type { LineHttpErrorClass } from "@/lib/line/line-types";

export const LINE_DELIVERY_ADAPTER_KIND = "mock" as const;

export type LineDeliveryAdapterRequest = {
  deliveryKey: string;
  textBody: string;
};

export type LineDeliveryAdapterResult = {
  adapter: typeof LINE_DELIVERY_ADAPTER_KIND;
  sentLine: false;
  timedOut: boolean;
  httpOk: boolean;
  httpStatus: number | null;
  lineRequestId: null;
  localErrorClass: LineHttpErrorClass | "send_closed" | null;
  message: string;
};

export type LineDeliveryAdapter = {
  kind: typeof LINE_DELIVERY_ADAPTER_KIND;
  send(request: LineDeliveryAdapterRequest): Promise<LineDeliveryAdapterResult>;
};

function closedMockResult(): LineDeliveryAdapterResult {
  return {
    adapter: LINE_DELIVERY_ADAPTER_KIND,
    sentLine: false,
    timedOut: false,
    httpOk: false,
    httpStatus: null,
    lineRequestId: null,
    localErrorClass: "send_closed",
    message: "Mock adapter 已拒絕發送。未呼叫 LINE Messaging API。",
  };
}

export function createMockLineMessagingAdapter(): LineDeliveryAdapter {
  return {
    kind: LINE_DELIVERY_ADAPTER_KIND,
    async send() {
      return closedMockResult();
    },
  };
}

/**
 * Test-only scripted outcomes. Still never uses the network.
 * Production dispatch must not import this helper.
 */
export function createScriptedMockLineMessagingAdapter(
  result: Omit<LineDeliveryAdapterResult, "adapter" | "sentLine" | "lineRequestId">,
): LineDeliveryAdapter {
  return {
    kind: LINE_DELIVERY_ADAPTER_KIND,
    async send() {
      return {
        ...result,
        adapter: LINE_DELIVERY_ADAPTER_KIND,
        sentLine: false,
        lineRequestId: null,
      };
    },
  };
}
