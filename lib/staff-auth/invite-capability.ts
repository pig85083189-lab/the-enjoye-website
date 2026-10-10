export type StaffInviteCapability = {
  enabled: boolean;
  configured: boolean;
  message: string;
};

export function getStaffInviteCapability(input?: {
  invitePilotEnabled?: boolean;
  inviteSendOpen?: boolean;
  serviceRoleKey?: string | null;
}): StaffInviteCapability {
  if (!input?.invitePilotEnabled) {
    return {
      enabled: false,
      configured: false,
      message: "登入邀請功能尚未啟用",
    };
  }
  if (!input.inviteSendOpen) {
    return {
      enabled: true,
      configured: false,
      message: "邀請寄送尚未開放",
    };
  }
  if (!input.serviceRoleKey) {
    return {
      enabled: true,
      configured: false,
      message: "登入邀請功能尚未設定",
    };
  }
  return {
    enabled: true,
    configured: true,
    message: "可寄送登入邀請",
  };
}

export function staffLoginBindingLabel(
  binding: "unbound" | "bound",
): string {
  return binding === "bound" ? "已綁定登入帳號" : "尚未綁定登入帳號";
}
