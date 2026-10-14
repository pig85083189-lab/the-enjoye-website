import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { lineOfficialAccountConnectionView } from "@/lib/line/line-broadcast-center-ui";
import { lineOfficialAccountNameLabel } from "@/lib/line/line-visibility";
import type { LineOfficialAccountPublic } from "@/lib/line/line-types";

const toneMap = {
  success: "success",
  warning: "warning",
  danger: "danger",
  neutral: "neutral",
} as const;

export function LineBroadcastConnectionStatus({
  organizationName,
  organizationId,
  account,
}: {
  organizationName: string;
  organizationId: string;
  account: LineOfficialAccountPublic | null;
}) {
  const connection = lineOfficialAccountConnectionView(account);

  return (
    <Card padding="lg" className="space-y-3" data-line-broadcast-connection>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] tracking-[0.16em] text-secondary-text">官方帳號</p>
          <h2 className="mt-1 text-[16px] font-semibold text-text">連線狀態</h2>
        </div>
        <Badge tone={toneMap[connection.tone]}>{connection.label}</Badge>
      </div>
      <p className="text-sm text-text" data-line-broadcast-organization>
        目前店家：{organizationName}
      </p>
      <p className="text-sm text-secondary-text" data-line-oa-name>
        官方帳號：{lineOfficialAccountNameLabel(account)}
      </p>
      <p className="text-[13px] text-secondary-text">{connection.detail}</p>
      <p className="text-[12px] text-secondary-text">
        發送組織以店家為準，即使多間店共用同一個 LINE Channel 也不會混用草稿或紀錄。
        <span className="sr-only">{organizationId}</span>
      </p>
    </Card>
  );
}
