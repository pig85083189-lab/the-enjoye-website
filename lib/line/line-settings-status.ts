import type { LineOfficialAccountPublic } from "@/lib/line/line-types";

export type LineSettingsLoadState = "idle" | "loading" | "ready" | "load_failed";
export type LineSettingsCredentialState = "unset" | "saved";

export type LineSettingsStatusView = {
  loadState: LineSettingsLoadState;
  credentialState: LineSettingsCredentialState;
  statusLabel: string;
  channelIdLabel: string;
  secretLabel: string;
  tokenLabel: string;
};

export type LineActionFeedback = {
  kind: "idle" | "success" | "error";
  message: string;
};

export const LINE_SETTINGS_LOAD_ERROR = "無法讀取 LINE 官方帳號設定";
export const LINE_SETTINGS_SAVE_ERROR = "LINE 憑證寫入失敗";
export const LINE_SETTINGS_SAVE_SUCCESS = "LINE 官方帳號憑證已加密保存";
export const LINE_SETTINGS_TEST_ERROR = "LINE 連線測試失敗";
export const LINE_SETTINGS_UNEXPECTED_ERROR = "操作失敗，請稍後再試";

export function lineCredentialState(
  account: LineOfficialAccountPublic | null | undefined,
): LineSettingsCredentialState {
  if (!account) return "unset";
  if (account.secretConfigured || account.tokenConfigured || account.channelId) {
    return "saved";
  }
  return "unset";
}

export function describeLineSettingsStatus(input: {
  loadState: LineSettingsLoadState;
  account: LineOfficialAccountPublic | null;
}): LineSettingsStatusView {
  if (input.loadState === "loading") {
    return {
      loadState: "loading",
      credentialState: "unset",
      statusLabel: "正在讀取 LINE 設定…",
      channelIdLabel: "讀取中",
      secretLabel: "讀取中",
      tokenLabel: "讀取中",
    };
  }
  if (input.loadState === "load_failed") {
    return {
      loadState: "load_failed",
      credentialState: "unset",
      statusLabel: LINE_SETTINGS_LOAD_ERROR,
      channelIdLabel: "讀取失敗",
      secretLabel: "讀取失敗",
      tokenLabel: "讀取失敗",
    };
  }
  const account = input.account;
  const credentialState = lineCredentialState(account);
  if (credentialState === "unset") {
    return {
      loadState: input.loadState,
      credentialState,
      statusLabel: "尚未保存 LINE 官方帳號憑證",
      channelIdLabel: "未設定",
      secretLabel: "未設定",
      tokenLabel: "未設定",
    };
  }
  return {
    loadState: input.loadState,
    credentialState,
    statusLabel: "已加密保存",
    channelIdLabel: account?.channelId || "已設定",
    secretLabel: account?.secretConfigured ? "Secret 已設定" : "未設定",
    tokenLabel: account?.tokenConfigured
      ? account.tokenHint
        ? `Token 已設定 ${account.tokenHint}`
        : "Token 已設定"
      : "未設定",
  };
}

export function applyLineSettingsLoadResult(input: {
  generation: number;
  currentGeneration: number;
  ok: boolean;
  account?: LineOfficialAccountPublic | null;
}): {
  ignored: boolean;
  loadState: LineSettingsLoadState;
  account: LineOfficialAccountPublic | null;
  feedback: LineActionFeedback;
} {
  if (input.generation !== input.currentGeneration) {
    return {
      ignored: true,
      loadState: "ready",
      account: null,
      feedback: { kind: "idle", message: "" },
    };
  }
  if (!input.ok) {
    return {
      ignored: false,
      loadState: "load_failed",
      account: null,
      feedback: { kind: "error", message: LINE_SETTINGS_LOAD_ERROR },
    };
  }
  return {
    ignored: false,
    loadState: "ready",
    account: input.account ?? null,
    feedback: { kind: "idle", message: "" },
  };
}

export function applyLineSettingsSaveResult(input: {
  generation: number;
  currentGeneration: number;
  ok: boolean;
  message: string;
  account?: LineOfficialAccountPublic | null;
}): {
  ignored: boolean;
  loadState: LineSettingsLoadState;
  account: LineOfficialAccountPublic | null;
  clearSecrets: boolean;
  feedback: LineActionFeedback;
} {
  if (input.generation !== input.currentGeneration) {
    return {
      ignored: true,
      loadState: "ready",
      account: null,
      clearSecrets: false,
      feedback: { kind: "idle", message: "" },
    };
  }
  if (!input.ok) {
    return {
      ignored: false,
      loadState: "ready",
      account: null,
      clearSecrets: false,
      feedback: { kind: "error", message: input.message || LINE_SETTINGS_SAVE_ERROR },
    };
  }
  return {
    ignored: false,
    loadState: "ready",
    account: input.account ?? null,
    clearSecrets: true,
    feedback: { kind: "success", message: input.message || LINE_SETTINGS_SAVE_SUCCESS },
  };
}

export function publicAccountAfterSave(input: {
  organizationId: string;
  channelId: string;
  tokenHint: string;
  previous?: LineOfficialAccountPublic | null;
}): LineOfficialAccountPublic {
  return {
    organizationId: input.organizationId,
    channelId: input.channelId,
    botDisplayName: input.previous?.botDisplayName ?? null,
    botBasicId: input.previous?.botBasicId ?? null,
    tokenHint: input.tokenHint,
    secretConfigured: true,
    tokenConfigured: true,
    broadcastEnabled: input.previous?.broadcastEnabled ?? false,
    lastTestedAt: input.previous?.lastTestedAt ?? null,
    lastTestStatus: input.previous?.lastTestStatus ?? null,
    lastTestMessage: input.previous?.lastTestMessage ?? null,
  };
}

export function lineActionCaughtError(fallback: string): LineActionFeedback {
  return { kind: "error", message: fallback || LINE_SETTINGS_UNEXPECTED_ERROR };
}
