export type DeliveryKind = "broadcast" | "automation";

/**
 * Length-prefixed delivery identity shared by broadcast and automation.
 * Prevents collisions when any segment contains `|` or `:`.
 */
export function lineDeliveryKey(input: {
  kind: DeliveryKind;
  organizationId: string;
  deliveryId: string;
  recipientId: string;
}): string | null {
  const organizationId = input.organizationId.trim();
  const deliveryId = input.deliveryId.trim();
  const recipientId = input.recipientId.trim();
  if (!organizationId || !deliveryId || !recipientId) return null;
  const parts = [input.kind, organizationId, deliveryId, recipientId];
  return parts.map((part) => `${part.length}:${part}`).join("|");
}
