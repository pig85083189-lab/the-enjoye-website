export type StaffInviteCapability = {
  configured: boolean;
  message: string;
};

export function getStaffInviteCapability(input?: {
  serviceRoleKey?: string | null;
}): StaffInviteCapability {
  if (!input?.serviceRoleKey) {
    return {
      configured: false,
      message: "登入邀請功能尚未設定",
    };
  }
  return {
    configured: true,
    message: "可寄送登入邀請",
  };
}

export function staffLoginBindingLabel(
  binding: "unbound" | "bound",
): string {
  return binding === "bound" ? "已綁定登入帳號" : "尚未綁定登入帳號";
}
