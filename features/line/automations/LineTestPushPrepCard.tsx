import { Card } from "@/components/ui/Card";
import {
  LINE_TEST_PUSH_PREP_BADGE,
  LINE_TEST_PUSH_PREP_CHANNEL_LABEL,
  LINE_TEST_PUSH_PREP_ENV_LABEL,
  LINE_TEST_PUSH_PREP_HINT,
  LINE_TEST_PUSH_PREP_RECIPIENT_LABEL,
  LINE_TEST_PUSH_PREP_SEND_LABEL,
  LINE_TEST_PUSH_PREP_TITLE,
  LINE_TEST_PUSH_PREP_UNKNOWN_BIND,
} from "@/lib/line/automations/copy";
import {
  canEnableTestPushSendButton,
  currentTestPushRecipientStatus,
  evaluateTestPushGates,
  maskTestPushChannelId,
  recommendedTestPushEnvironment,
  TEST_PUSH_PREVIEW_TEXT,
} from "@/lib/line/automations/test-push-oneshot-prep";

export function LineTestPushPrepCard() {
  const env = recommendedTestPushEnvironment();
  const recipient = currentTestPushRecipientStatus();
  const checks = evaluateTestPushGates({
    recipient: { readable: false },
    textBody: TEST_PUSH_PREVIEW_TEXT,
  });

  return (
    <Card
      padding="lg"
      data-line-test-push-prep
      data-line-test-push-sent="false"
      data-line-test-push-send-open="false"
    >
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[16px] font-semibold text-text">{LINE_TEST_PUSH_PREP_TITLE}</h2>
        <span className="rounded-full bg-primary-light px-2.5 py-1 text-[11px] font-medium text-primary">
          {LINE_TEST_PUSH_PREP_BADGE}
        </span>
      </div>
      <p className="mt-2 text-[13px] leading-relaxed text-secondary-text">{LINE_TEST_PUSH_PREP_HINT}</p>
      <dl className="mt-3 grid gap-2 text-[13px] sm:grid-cols-2">
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_PREP_ENV_LABEL}</dt>
          <dd className="font-medium text-text">Preview TEST · 正式網站只可看 UI</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_PREP_CHANNEL_LABEL}</dt>
          <dd className="font-medium text-text">{maskTestPushChannelId()}</dd>
        </div>
        <div>
          <dt className="text-secondary-text">{LINE_TEST_PUSH_PREP_RECIPIENT_LABEL}</dt>
          <dd className="font-medium text-text">
            {recipient.hint} · {LINE_TEST_PUSH_PREP_UNKNOWN_BIND}
          </dd>
        </div>
        <div>
          <dt className="text-secondary-text">跨庫複製</dt>
          <dd className="font-medium text-text">
            {env.copyPreviewBindToProduction ? "允許" : "禁止"}
          </dd>
        </div>
      </dl>
      <div className="mt-3 rounded-2xl bg-white px-4 py-3 text-[13px] whitespace-pre-wrap text-text">
        {TEST_PUSH_PREVIEW_TEXT}
      </div>
      <ul className="mt-3 space-y-1 text-[13px] text-secondary-text">
        {checks.gates.map((gate) => (
          <li key={gate.id} data-line-test-push-gate={gate.id} data-line-test-push-gate-ok={String(gate.ok)}>
            {gate.ok ? "通過" : "未通過"} · {gate.message}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!canEnableTestPushSendButton()}
        data-line-test-push-send
        className="mt-4 inline-flex min-h-10 items-center rounded-full bg-primary/40 px-4 text-[13px] font-medium text-white"
      >
        {LINE_TEST_PUSH_PREP_SEND_LABEL}
      </button>
    </Card>
  );
}
