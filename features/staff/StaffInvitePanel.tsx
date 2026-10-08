"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  inviteStaffLoginAction,
  revokeStaffLoginInviteAction,
} from "@/lib/staff-auth/actions";
import type { StaffInviteRecord } from "@/lib/staff-auth/staff-invite-command";
import {
  canShowStaffInviteControl,
  canShowStaffInviteRevokeControl,
  staffInviteBindingLabel,
  type StaffInviteTargetVisibility,
} from "@/lib/staff-auth/staff-invite-visibility";
import type { StaffRole } from "@/types/saas";

export function StaffInvitePanel({
  invitePilotEnabled,
  inviteSendOpen,
  actorRole,
  actorActive,
  actorOrganizationId,
  target,
  invite,
  binding,
  onChanged,
}: {
  invitePilotEnabled: boolean;
  inviteSendOpen: boolean;
  actorRole: StaffRole | null;
  actorActive: boolean;
  actorOrganizationId: string | null;
  target: StaffInviteTargetVisibility;
  invite: StaffInviteRecord | null;
  binding: "bound" | "unbound" | "pending";
  onChanged?: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const showInvite = canShowStaffInviteControl({
    invitePilotEnabled,
    inviteSendOpen,
    actorRole,
    actorActive,
    actorOrganizationId,
    target,
  });
  const showRevoke = canShowStaffInviteRevokeControl({
    invitePilotEnabled,
    actorRole,
    actorActive,
    actorOrganizationId,
    invite,
  });

  if (!showInvite && !showRevoke) return null;

  async function runInvite(mode: "invite" | "resend") {
    setBusy(true);
    setMessage("");
    const result = await inviteStaffLoginAction({
      email: target.email ?? undefined,
      membershipId: target.membershipId,
      organizationId: target.organizationId,
      mode,
    });
    setBusy(false);
    setMessage(result.ok ? "邀請已處理" : result.message);
    onChanged?.();
  }

  return (
    <section
      data-staff-invite-panel
      data-staff-invite-visible={showInvite ? "true" : "false"}
      className="space-y-2 rounded-2xl border border-border px-3.5 py-3.5"
    >
      <p className="text-[13px] font-medium text-text">登入邀請</p>
      <p className="text-[12px] text-secondary-text" data-staff-login-binding>
        {staffInviteBindingLabel(binding)}
      </p>
      {target.email ? (
        <p className="truncate text-[12px] text-secondary-text">{target.email}</p>
      ) : (
        <p className="text-[12px] text-secondary-text">這位員工沒有可邀請的 Email</p>
      )}
      {showInvite ? (
        <Button
          className="h-10 min-h-10 w-full rounded-full"
          disabled={busy}
          data-staff-invite-send
          onClick={() => void runInvite(binding === "pending" ? "resend" : "invite")}
        >
          {busy ? "處理中…" : binding === "pending" ? "重寄登入邀請" : "邀請登入"}
        </Button>
      ) : (
        <p className="text-[11px] text-secondary-text">
          登入邀請預設關閉，僅店長可在開放後邀請未綁定員工。
        </p>
      )}
      {showRevoke && invite ? (
        <Button
          variant="outline"
          className="h-10 min-h-10 w-full rounded-full"
          disabled={busy}
          data-staff-invite-revoke
          onClick={async () => {
            setBusy(true);
            setMessage("");
            const result = await revokeStaffLoginInviteAction({
              inviteId: invite.id,
              organizationId: target.organizationId,
            });
            setBusy(false);
            setMessage(result.ok ? "邀請已撤銷" : result.message);
            onChanged?.();
          }}
        >
          撤銷邀請
        </Button>
      ) : null}
      {message ? (
        <p className="text-[12px] text-[#B07A4A]" role="alert">
          {message}
        </p>
      ) : null}
    </section>
  );
}
