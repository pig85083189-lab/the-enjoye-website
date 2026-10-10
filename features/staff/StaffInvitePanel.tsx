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
  canShowStaffInviteStatus,
  deriveStaffInviteLifecycle,
  staffInviteLifecycleLabel,
  staffInviteSendButtonLabel,
  staffInviteSendMode,
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
  const lifecycle = deriveStaffInviteLifecycle({
    authUserId: target.authUserId,
    invite,
  });
  void binding;
  const showStatus = canShowStaffInviteStatus({
    actorRole,
    actorActive,
    actorOrganizationId,
    target,
  });
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

  if (!showStatus && !showInvite && !showRevoke) return null;

  async function runInvite() {
    setBusy(true);
    setMessage("");
    const result = await inviteStaffLoginAction({
      email: target.email ?? undefined,
      membershipId: target.membershipId,
      organizationId: target.organizationId,
      mode: staffInviteSendMode(lifecycle),
    });
    setBusy(false);
    setMessage(result.message);
    onChanged?.();
  }

  return (
    <section
      data-staff-invite-panel
      data-staff-invite-visible={showInvite ? "true" : "false"}
      data-staff-invite-lifecycle={lifecycle}
      className="space-y-2 rounded-2xl border border-border px-3.5 py-3.5"
    >
      <p className="text-[13px] font-medium text-text">登入邀請</p>
      <p className="text-[12px] text-secondary-text" data-staff-login-binding>
        {staffInviteLifecycleLabel(lifecycle)}
      </p>
      {target.email ? (
        <p className="truncate text-[12px] text-secondary-text">{target.email}</p>
      ) : (
        <p className="text-[12px] text-secondary-text">這位員工沒有可邀請的 Email</p>
      )}
      {showInvite ? (
        <>
          {!inviteSendOpen ? (
            <p className="text-[11px] text-secondary-text">
              目前不會寄出信件（寄送尚未開放）。
            </p>
          ) : null}
          <Button
            className="h-10 min-h-10 w-full rounded-full"
            disabled={busy}
            data-staff-invite-send
            onClick={() => void runInvite()}
          >
            {busy ? "處理中…" : staffInviteSendButtonLabel(lifecycle)}
          </Button>
        </>
      ) : lifecycle === "activated" ? (
        <p className="text-[11px] text-secondary-text">這位員工已可登入工作台。</p>
      ) : (
        <p className="text-[11px] text-secondary-text">
          僅店長可為未綁定員工寄送登入邀請。
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
