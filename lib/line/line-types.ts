export type LineConnectionTestStatus = "ok" | "failed" | "not_configured";

export type LineBroadcastStatus =
  | "draft"
  | "confirm_pending"
  | "send_closed"
  | "queued"
  | "sending"
  | "accepted"
  | "failed"
  | "canceled"
  | "pending_confirmation";

export type LineApiResult =
  | "accepted"
  | "failed"
  | "pending_confirmation"
  | "send_closed";

export type LineOfficialAccountPublic = {
  organizationId: string;
  channelId: string | null;
  botDisplayName: string | null;
  botBasicId: string | null;
  tokenHint: string | null;
  secretConfigured: boolean;
  tokenConfigured: boolean;
  broadcastEnabled: boolean;
  lastTestedAt: string | null;
  lastTestStatus: LineConnectionTestStatus | null;
  lastTestMessage: string | null;
};

export type LineBroadcastPublic = {
  id: string;
  organizationId: string;
  status: LineBroadcastStatus;
  textBody: string;
  requestId: string;
  lineRequestId: string | null;
  apiResult: LineApiResult | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
  confirmedAt: string | null;
};

export type LineDecisionReason =
  | "pilot_disabled"
  | "unauthorized"
  | "not_configured"
  | "invalid_input"
  | "send_closed"
  | "quota_exceeded"
  | "duplicate"
  | "pending_confirmation"
  | "error";
