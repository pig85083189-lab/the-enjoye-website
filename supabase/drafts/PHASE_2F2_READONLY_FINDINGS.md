# Phase 2F-2 read-only findings

This file records a verification pass. It does not authorize SQL apply, deploy, webhook edits, or send.

## Access this run actually had

| Check | Result |
| --- | --- |
| LINE Developers Messaging API Channel `2009219238` webhook endpoint | **D / UNKNOWN**. `GET https://api.line.me/v2/bot/channel/webhook/endpoint` returned 401 Authorization header required. This environment has no Channel Access Token and Vercel CLI is logged out. |
| Production bind rows on `knccefcxncglgpmvgqlp` | **UNKNOWN**. REST without a key returned 401. No service-role or Owner session was available. Preview data was not used. |
| Official site webhook route | Host probe only. `GET https://the-enjoye-website.vercel.app/api/line/webhook/org-the-enjoye/{dummy}` returned `200 {"ok":true,"bound":false}`. That GET handler always returns `bound:false` and does **not** prove LINE Developers points here. |
| Preview webhook alias | Same GET shape still answers on `the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app`. |

No Token, Secret, raw LINE userId, or customer PII was printed.

## A. Official webhook target

**D. 無法確認。**

Do not infer A or B from host probes or from `BEAUTY_OS_LINE_WEBHOOK_BASE_URL`. Those are not the LINE Developers setting.

Owner manual steps:

1. Open https://developers.line.biz and sign in. Do not change settings.
2. Open Messaging API Channel `2009219238` (official account `ai`).
3. Open Messaging API settings and look at Webhook URL only. Do not Update, do not rotate Token / Secret.
4. Classify the host + path:
   - `the-enjoye-website.vercel.app` + `/api/line/webhook/org-the-enjoye/…` → A
   - `the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app` → B
   - anything else → C
5. Report the class. A masked host/path is enough.

## B. Production Owner bind

**UNKNOWN.** Cannot confirm a trusted official webhook-verified Enjoye Owner bind.

A later trusted row must show, without raw userId:

- `organization_id = org-the-enjoye`
- operational `staff_user_id` matching the logged-in Owner
- `bind_method = webhook_code`
- hint starting with `••••`
- `key_id = line-cred-v1`
- not unbound / blocked

Current Production UI `loadLineOwnerRecipient` does not select `staff_user_id`, so a screen that only says “已綁定 ••••” is not enough.

## C. SQL draft residual risk

Local unix-socket review of `20261016120000_line_owner_self_reminder_grant_production.sql` still passes. Residual risks if someone applied it too early:

- Authenticated Enjoye Owner could call grant / issue / revoke RPCs even while the UI stays disabled.
- `service_role` can arm runtime identity and claim; claim still returns `send_open: false`.
- Applying before a trusted bind exists would not forge identity, but it would add write surface that is not needed yet.

The draft still: Enjoye-only, no Preview fixtures, no fake appointment, Owner-only RLS, independent of test-push, Channel lock `870121`, no default grant/oneshot rows, Broadcast send flag closed.

## D. Webhook program

No URL change. Official site already serves the existing consume path. If Developers later proves A, the missing pieces are Enjoye bind-start UI and `staff_user_id` on the recipient read. If it proves B, do not rotate the token; wait for a later approved host move.

## E. Next minimal deploy

Blocked on Owner webhook class + a readable Production bind check. See integration steps in the PR.

## F. Broadcast

Unchanged. `LINE_BROADCAST_SEND_OPEN = false`. No Broadcast send code, Channel lock, token, or settings were edited.
