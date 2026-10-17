# Phase 2F-3 official webhook cutover plan

Planning only. Owner confirmed Channel `2009219238` still points at the Preview alias. This phase does **not** change that URL.

## Access this run had

| Item | Result |
| --- | --- |
| LINE Developers URL | Owner confirmed **B / Preview alias**. Path org + token not disclosed (correct). |
| Preview alias deploy commit | **UNKNOWN**. Vercel API 403; CLI logged out. Last documented assignment: PR #32 branch `cursor/line-official-account-phase-1-7c7d`. Later Preview deploys may have moved the alias. |
| Production UI | Live official site is `9e3db40`. Webhook route files are unchanged from that commit on this branch. |
| Host probes | Not used as proof of LINE delivery. GET 200 is only admission. |

Unsigned POST probes (dummy token, no LINE userId):

| Host | GET bad org / short token | POST no/fake signature |
| --- | --- | --- |
| Official site | 404 `{"ok":false}` | 403 `{"ok":false}` |
| Preview alias | 404 `{"ok":false}` | 403 `{"ok":false}` |

Preview alias non-webhook paths (`/`, `/staff`, settings) return 404 host lock. Official site `/staff/line/automations` still 307 to login.

No Token, Secret, raw LINE userId, or public token was printed.

## A. 舊 Webhook 實際承接的功能

The Preview alias is a **webhook-only host**. It is not the staff app.

Code on this Production LINE base (and unchanged vs `9e3db40`) only does:

- Admit `org-*` + 32–128 char public token
- Read Channel Secret ciphertext via token-gated RPC on **that deployment’s Supabase**
- HMAC-SHA256 verify `x-line-signature`
- Accept only `source.type=user` text that is an 8-hex bind code
- Dedup `webhookEventId` per organization
- Consume one Owner bind challenge (10 minutes, 5 attempts)
- Encrypt LINE userId; store hint `••••` + `webhook_code` + challenge `staff_user_id`

It does **not** handle follow / unfollow / postback / image, does not auto-unbind, does not block users, and does not send.

Unbind is an Owner staff RPC, not a LINE event. There is no webhook block-list.

GET 200 with `bound:false` is a liveness shape, not proof LINE is delivering or that bind works.

## B. Production 是否具備完整接手能力

**No. Partial route compatibility only.**

Same next to `9e3db40`:

- Same route, admission, signature, consume, dedup, 403/404/200 contract
- Official site already accepts webhook POST (403 without a valid signature, not 404)
- Production is the full staff app (`BEAUTY_OS_LINE_WEBHOOK_HOST` appears unset; otherwise `/staff` would 404)

Gaps / UNKNOWN:

- Official site talks to Production Supabase `knccefcxncglgpmvgqlp`, not Preview `bfzquejrtgqzzarhkiya`
- Preview public tokens, challenges, recipients, and `webhook_events` are not on Production
- Production Enjoye public token existence UNKNOWN
- `BEAUTY_OS_LINE_CREDENTIAL_KEY` on Production UNKNOWN (must match Production ciphertext; do not rotate)
- Enjoye settings UI hides webhook URL and bind-start (`canShowLineEngineerDiagnostics` is TEST-only)
- `loadLineOwnerRecipient` still does not select `staff_user_id`

Do not copy Preview identity or grants into Production.

## C. TEST 與其他店家的影響

Channel `2009219238` has **one** Developers Webhook URL. Path includes one `organizationId`.

- After a switch to official Enjoye path: TEST webhook bind consume stops. Preview TEST rows stay on Preview DB; they are not deleted and must not be copied.
- After a switch that keeps a TEST path: events hit Production DB, which will not see Preview TEST challenges. TEST bind still breaks; Enjoye bind still does not start.
- Other shops: no confirmed third official account on this Channel. If one exists, mark it UNKNOWN / BLOCKER until Owner confirms.
- Broadcast send does not use webhook. SEND stays closed. No Broadcast code change in this phase.
- Events that arrive after switch are not written to Preview. They can be lost for TEST bind.

Same receiver already routes by path org + token. It cannot serve two orgs on one Channel URL.

## D. BLOCKER

All of the following block asking Owner to change the URL now:

1. Preview alias exact commit / env UNKNOWN
2. Developers path org UNKNOWN (Owner should report org segment only)
3. Production public token / secret row UNKNOWN
4. Single Channel / single URL / single org path
5. Preview DB ≠ Production DB (hostname switch is a backend cutover)
6. Enjoye bind UI gated to TEST
7. Production credential key UNKNOWN
8. Dedup / challenge state is not portable; do not migrate rows

## E. 最小安全切換方案

Do **not** switch in this phase.

Later, only if every blocker is cleared or Owner explicitly accepts the TEST pause:

1. Owner reports path org only.
2. Confirm Preview alias commit.
3. Ship Enjoye bind-start + webhook URL display on official site (still no Developers edit).
4. Confirm Production token exists **without rotating**.
5. Official Verify rehearsal: signed empty `events` from LINE Verify only, after Owner approves the URL move.
6. Watch 403/503 vs 200. Dedup stays on Production `line_webhook_events`.
7. Keep SEND closed.

New URL shape (token redacted):  
`https://the-enjoye-website.vercel.app/api/line/webhook/org-the-enjoye/{publicToken}`  
Old URL shape:  
`https://the-enjoye-line-webhook-preview-pig85083189-6631s-projects.vercel.app/api/line/webhook/{org}/{publicToken}`

## F. 回復與事件補救

1. Put Developers URL back to the old Preview alias + original path. Do not rotate Channel Token / Secret.
2. Press Verify.
3. Do not copy Production `webhook_events` or recipients to Preview.
4. Re-issue bind codes after rollback. Do not replay old codes.
5. LINE will not replay a missed history. Do not Push / Broadcast to compensate.

## G. Owner 下一次需要核准的具體操作

1. 回報 Developers 路徑店家段（`org-the-enjoye` 或 `org-beauty-os-test`），不要貼 token。
2. 是否接受 TEST webhook 綁定在正式切換後暫停。
3. 下一階段：正式網站 Enjoye 綁定啟動面（仍不改 Developers URL）。
4. **在以上完成前，不要核准把 Webhook 改成 Production URL。**
