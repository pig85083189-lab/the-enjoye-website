import { Card } from "@/components/ui/Card";
import {
  LINE_TEST_PUSH_ACCEPT_BADGE,
  LINE_TEST_PUSH_ACCEPT_BLOCK,
  LINE_TEST_PUSH_ACCEPT_BLOCK_LABEL,
  LINE_TEST_PUSH_ACCEPT_CLAIM,
  LINE_TEST_PUSH_ACCEPT_CLAIM_LABEL,
  LINE_TEST_PUSH_ACCEPT_HINT,
  LINE_TEST_PUSH_ACCEPT_NEXT_LABEL,
  LINE_TEST_PUSH_ACCEPT_RECIPIENT_LABEL,
  LINE_TEST_PUSH_ACCEPT_RETRY,
  LINE_TEST_PUSH_ACCEPT_RETRY_LABEL,
  LINE_TEST_PUSH_ACCEPT_SCHEMA_LABEL,
  LINE_TEST_PUSH_ACCEPT_TITLE,
  LINE_TEST_PUSH_ACCEPT_UNKNOWN,
} from "@/lib/line/automations/copy";
import {
  currentPreviewBindConfirmation,
  inspectPreviewRemoteSchema,
  nextOwnerApprovedMinimumAction,
  remainingFirstSendBlockers,
} from "@/lib/line/automations/test-push-oneshot-acceptance";
import { canEnableTestPushSendButton } from "@/lib/line/automations/test-push-oneshot-prep";

export function LineTestPushAcceptanceCard() {
  const bind = currentPreviewBindConfirmation();
  const schema = inspectPreviewRemoteSchema();
  const nextAction = nextOwnerApprovedMinimumAction();
  const blockers = remainingFirstSendBlockers();

  return (
    <Card
      padding="lg"
      data-line-test-push-accept
      data-line-test-push-sent="false"
      data-line-test-push-send-open="false"
      data-line-preview-bind={bind.status}
      data-line-preview-schema={schema.verdict}
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-text">{LINE_TEST_PUSH_ACCEPT_TITLE}</h2>
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-medium text-primary">
          {LINE_TEST_PUSH_ACCEPT_BADGE}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">{LINE_TEST_PUSH_ACCEPT_HINT}</p>
      <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_ACCEPT_RECIPIENT_LABEL}</dt>
          <dd className="font-medium text-text">
            {bind.hint} · {LINE_TEST_PUSH_ACCEPT_UNKNOWN}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_ACCEPT_SCHEMA_LABEL}</dt>
          <dd className="font-medium text-text">
            本機草案存在 · 遠端 {LINE_TEST_PUSH_ACCEPT_UNKNOWN}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_ACCEPT_CLAIM_LABEL}</dt>
          <dd className="font-medium text-text">{LINE_TEST_PUSH_ACCEPT_CLAIM}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_ACCEPT_RETRY_LABEL}</dt>
          <dd className="font-medium text-text">{LINE_TEST_PUSH_ACCEPT_RETRY}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_ACCEPT_BLOCK_LABEL}</dt>
          <dd className="font-medium text-text">{LINE_TEST_PUSH_ACCEPT_BLOCK}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_ACCEPT_NEXT_LABEL}</dt>
          <dd className="font-medium text-text">{nextAction}</dd>
        </div>
      </dl>
      <ul className="mt-3 space-y-1 text-[13px] text-secondary-text">
        {blockers.map((row) => (
          <li key={row}>未完成 · {row}</li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!canEnableTestPushSendButton()}
        data-line-test-push-accept-send
        className="mt-4 inline-flex min-h-10 items-center rounded-full bg-primary/40 px-4 text-[13px] font-medium text-white"
      >
        發送一則測試 LINE（尚未開放）
      </button>
    </Card>
  );
}
