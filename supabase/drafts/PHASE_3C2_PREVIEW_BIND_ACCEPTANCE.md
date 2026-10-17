# Phase 3C-2 Preview TEST bind confirmation and one-shot safety

Built on Phase 3C-1 (`10adda9` / Draft PR #59). Still does not send LINE, apply remote SQL, deploy, open SEND, or change Broadcast / Developers Webhook.

## A. Preview recipient

This run has no Preview database credentials and `PREVIEW_READONLY_QUERY_ALLOWED` is false. Recipient status is **UNKNOWN**. Hint `••••`. Bind method unconfirmed. Owner identity unconfirmed. No raw LINE userId.

Owner can confirm in Preview staff UI: login as Beauty OS TEST Owner; report only masked hint last four, Channel last four `9238`, `webhook_code`, and whether the bind is still present.

## B. Preview remote schema

Local drafts exist (`line_owner_recipients`, `line_test_sends`, `claim_line_test_send`, quota count inside claim, Broadcast `line_broadcast_oneshot_permits`). Remote applied status is **UNKNOWN**. Do not treat repo SQL as Preview truth.

`line_broadcast_oneshot_permits` is the Broadcast oneshot and must not be reused for appointment-reminder Push. Appointment-reminder oneshot grant has no local migration.

## C. Grant and dedup

Formal send must persist an atomic claim that binds grant + requestId + masked recipient + Channel `2009219238`. Local `Set` is forbidden as a remote guarantee. This phase models the claim as rows for isolation tests only.

## D. Retry

Timeout, 5xx, or unknown delivery → `pending_confirmation`. `shouldRetryTestPush` is always false.

## E. Block and revoke

Webhook does not observe unfollow/block. Unknown block or revoke fails closed. Unknown Owner identity fails closed.

## F. Tests

Local fake-data isolation: replay, concurrent, expired, revoked, cross-shop, recipient/channel mismatch, 5xx/timeout no retry, send switches closed.

## G / H

First real send is blocked. Next Owner-approved minimum action: read-only Preview bind confirmation. Do not apply SQL, deploy, or open SEND in that step.
