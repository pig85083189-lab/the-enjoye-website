/**
 * Screen state after the beautician presses 儲存並完成服務.
 * A member-sync failure stays on the complete step. It does not mark the
 * appointment completed and it does not ask React to render a server error.
 */

export type MemberSyncActionResult =
  | { ok: true }
  | { ok: false; message: string };

export type MemberSyncScreen = {
  finished: boolean;
  markAppointmentCompleted: boolean;
  error: string;
};

const SERVER_RENDER_ERROR = "Minified React error #441";

export function memberSyncCompletionState(result: MemberSyncActionResult): MemberSyncScreen {
  if (result.ok) {
    return { finished: true, markAppointmentCompleted: true, error: "" };
  }
  const message = result.message.trim();
  if (!message || message.includes(SERVER_RENDER_ERROR)) {
    return {
      finished: false,
      markAppointmentCompleted: false,
      error: "療程已儲存，但會員同步失敗。請再次按完成療程，勿另建療程。",
    };
  }
  return { finished: false, markAppointmentCompleted: false, error: message };
}

export type PublicationRpcStatus = "ok" | "conflict" | "revoked" | "mismatch" | "unauthorized" | "error";

/** Map the publication function's text result. An RPC exception is not a status. */
export function publicationRpcStatus(data: unknown): PublicationRpcStatus {
  if (data === "inserted") return "ok";
  if (data === "already") return "conflict";
  if (data === "revoked" || data === "mismatch" || data === "unauthorized") return data;
  return "error";
}

/**
 * A direct service-role insert is only the substitute for a function that
 * returned unauthorized. A unique conflict is re-read. Any other database
 * error stays a failure and does not update the row.
 */
export function publicationFallbackInsertStatus(code: string | null | undefined): "ok" | "conflict" | "error" {
  if (!code) return "ok";
  if (code === "23505") return "conflict";
  return "error";
}

/** Constraint name or a short raised message. Row contents are never returned. */
export function publicationWriteFailure(error: { code?: string | null; message?: string | null } | null | undefined): {
  code: string;
  constraint: string | null;
  raised: string | null;
} {
  const code = error?.code || "unknown";
  const message = typeof error?.message === "string" ? error.message : "";
  const constraint = message.match(/constraint "([A-Za-z0-9_]+)"/)?.[1] ?? null;
  const firstLine = message.split("\n")[0]?.trim() ?? "";
  const raised = !constraint && firstLine && !/failing row|detail/i.test(firstLine)
    ? firstLine.slice(0, 160)
    : null;
  return { code, constraint, raised };
}
