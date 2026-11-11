export type BindingRecoveryOutcome = "bound" | "unbound" | "conflict" | "unknown";

/** Never infer failure from a missing/failed write response alone. */
export function classifyBindingRecovery(
  readError: boolean,
  membershipFound: boolean,
  currentAuthUserId: string | null,
  createdAuthUserId: string,
): BindingRecoveryOutcome {
  if (readError || !membershipFound) return "unknown";
  if (currentAuthUserId === createdAuthUserId) return "bound";
  if (currentAuthUserId !== null) return "conflict";
  return "unbound";
}
