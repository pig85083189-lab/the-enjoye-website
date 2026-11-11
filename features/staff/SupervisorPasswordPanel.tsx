"use client";

import { useState } from "react";
import { supervisorProvisionStaffLoginAction } from "@/lib/staff-auth/supervisor-staff-provision-action";
import { supervisorSetStaffPasswordAction } from "@/lib/staff-auth/supervisor-password-reset-action";
import { authorizeSupervisorPasswordReset } from "@/lib/staff-auth/supervisor-password-reset-policy";
import type { StaffRole } from "@/types/saas";

export function SupervisorPasswordPanel(props: {
  organizationId: string;
  membershipId: string;
  targetName: string;
  targetAuthUserId: string | null;
  targetRole: StaffRole;
  targetActive: boolean;
  actorRole: StaffRole | null;
  actorActive: boolean;
  actorAuthUserId: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const decision = authorizeSupervisorPasswordReset({
    actorAuthUserId: props.actorAuthUserId,
    actorRole: props.actorRole,
    actorActive: props.actorActive,
    actorOrganizationId: props.organizationId,
    targetAuthUserId: props.targetAuthUserId,
    targetRole: props.targetRole,
    targetActive: props.targetActive,
    targetOrganizationId: props.organizationId,
  });
  const supervisor = props.actorActive && (props.actorRole === "OWNER" || props.actorRole === "MANAGER");
  const manageableRole = props.targetRole !== "OWNER" && (props.targetRole !== "MANAGER" || props.actorRole === "OWNER");
  if (!supervisor || !manageableRole || !props.targetActive ||
      (props.actorAuthUserId && props.actorAuthUserId === props.targetAuthUserId)) return null;
  if (!props.targetAuthUserId) {
    async function provision(event: React.FormEvent<HTMLFormElement>) {
      event.preventDefault();
      if (busy) return;
      if (password !== confirm) { setMessage("兩次輸入的密碼不一致"); return; }
      setBusy(true); setMessage("");
      try {
        const result = await supervisorProvisionStaffLoginAction({
          organizationId: props.organizationId, membershipId: props.membershipId,
          email, newPassword: password,
        });
        setMessage(result.message);
        if (result.ok) { setPassword(""); setConfirm(""); setOpen(false); }
      } catch { setMessage("開通失敗，請聯絡管理員"); }
      finally { setBusy(false); }
    }
    return (
      <section className="mt-3 rounded-2xl border border-border p-3" data-supervisor-password-panel>
        <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-sm font-medium"
          onClick={() => { setOpen(!open); setMessage(""); }}>
          {open ? "取消開通" : "主管開通員工登入帳號"}
        </button>
        {open ? (
          <form className="mt-3 space-y-3" onSubmit={provision}>
            <p className="text-xs text-secondary-text">為 {props.targetName} 建立登入帳號，不寄送驗證信。Email 若已有帳號將拒絕建立。</p>
            <label className="block text-xs">員工 Email
              <input type="email" autoComplete="off" required value={email}
                onChange={e => setEmail(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border p-2" />
            </label>
            <label className="block text-xs">新密碼
              <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required
                value={password} onChange={e => setPassword(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border p-2" />
            </label>
            <label className="block text-xs">確認新密碼
              <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required
                value={confirm} onChange={e => setConfirm(e.target.value)}
                className="mt-1 w-full rounded-xl border border-border p-2" />
            </label>
            <button type="submit" disabled={busy} className="w-full rounded-full bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
              {busy ? "開通中…" : "確認開通員工帳號"}
            </button>
          </form>
        ) : <p className="mt-2 text-xs text-secondary-text">此員工尚未綁定登入帳號。</p>}
        {message ? <p role="status" className="mt-2 text-xs">{message}</p> : null}
      </section>
    );
  }
  if (!decision.allowed) return null;
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (password !== confirm) {
      setMessage("兩次輸入的密碼不一致");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      const result = await supervisorSetStaffPasswordAction({
        organizationId: props.organizationId,
        membershipId: props.membershipId,
        newPassword: password,
      });
      setMessage(result.message);
      if (result.ok) {
        setPassword("");
        setConfirm("");
        setOpen(false);
      }
    } catch {
      setMessage("無法完成密碼設定，請稍後再試");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-3 rounded-2xl border border-border p-3" data-supervisor-password-panel>
      <button type="button" className="w-full rounded-xl border border-border px-3 py-2 text-sm font-medium"
        onClick={() => { setOpen(!open); setMessage(""); }}>
        {open ? "取消設定密碼" : "主管設定員工密碼"}
      </button>
      {open ? (
        <form className="mt-3 space-y-3" onSubmit={submit}>
          <p className="text-xs text-secondary-text">為 {props.targetName} 設定正式登入密碼，不會寄送驗證信。</p>
          <label className="block text-xs">新密碼
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required
              value={password} onChange={e => setPassword(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border p-2" />
          </label>
          <label className="block text-xs">確認新密碼
            <input type="password" autoComplete="new-password" minLength={12} maxLength={128} required
              value={confirm} onChange={e => setConfirm(e.target.value)}
              className="mt-1 w-full rounded-xl border border-border p-2" />
          </label>
          <p className="text-xs text-secondary-text">至少 12 字元，包含英文字母與數字。</p>
          <button type="submit" disabled={busy} className="w-full rounded-full bg-primary px-3 py-2 text-sm text-white disabled:opacity-50">
            {busy ? "正在設定…" : "確認設定正式密碼"}
          </button>
        </form>
      ) : null}
      {message ? <p role="status" className="mt-2 text-xs">{message}</p> : null}
    </section>
  );
}
