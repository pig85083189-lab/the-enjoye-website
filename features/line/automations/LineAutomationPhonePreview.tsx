import { ChevronLeft } from "lucide-react";
import { LINE_AUTOMATION_TEMPLATE_CARDS } from "@/lib/line/automations/catalog";
import type {
  LineAutomationId,
  LineAutomationQuickReply,
} from "@/lib/line/automations/types";
import { cn } from "@/lib/utils";

export function LineAutomationPhonePreview({
  officialName,
  templateTitle,
  textBody,
  quickReplies,
  selectedId,
  onSelectTemplate,
}: {
  officialName: string;
  templateTitle: string;
  textBody: string;
  quickReplies: readonly LineAutomationQuickReply[];
  selectedId: LineAutomationId;
  onSelectTemplate?: (id: LineAutomationId) => void;
}) {
  return (
    <section
      data-line-automation-preview
      className="rounded-[20px] border border-border bg-[#FFFCFB] p-4 shadow-[0_1px_2px_rgba(48,43,43,0.04)] sm:p-5"
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-semibold text-text">訊息範本預覽</h2>
        <span
          data-line-automation-preview-title
          className="rounded-full border border-[#E8D0CE] bg-white px-3 py-1 text-[12px] text-primary"
        >
          {templateTitle}
        </span>
      </div>

      <div className="mx-auto w-[min(100%,280px)]">
        <div className="relative overflow-hidden rounded-[2rem] border-[8px] border-[#1C1C1E] bg-[#1C1C1E] shadow-[0_16px_40px_rgba(48,43,43,0.16)]">
          <div className="overflow-hidden rounded-[1.45rem] bg-[#F2F2F7]">
            <div className="relative bg-white px-4 pb-2 pt-2">
              <div className="absolute left-1/2 top-1.5 h-4 w-20 -translate-x-1/2 rounded-full bg-[#1C1C1E]" />
              <div className="flex items-center justify-between pt-4 text-[11px] font-medium text-text">
                <span>10:00</span>
                <span className="flex items-center gap-1 text-[10px] text-secondary-text">
                  ●●●● LTE
                </span>
              </div>
              <div className="mt-1 flex items-center gap-1 border-b border-[#EEE] pb-2">
                <ChevronLeft className="h-5 w-5 text-[#06C755]" aria-hidden />
                <p className="truncate text-[15px] font-semibold text-text">{officialName}</p>
              </div>
            </div>

            <div className="min-h-[320px] space-y-2 bg-[#8E9AA4] px-3 py-3">
              <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white px-3 py-2.5 text-[13px] leading-relaxed text-text whitespace-pre-wrap shadow-sm">
                {textBody || "尚未輸入文字"}
              </div>
              <p className="pl-1 text-[10px] text-white/80">10:00</p>
              {quickReplies.length > 0 ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {quickReplies.map((reply) => (
                    <span
                      key={reply.id}
                      className="rounded-full border border-white/70 bg-white/95 px-2.5 py-1 text-[11px] text-[#1A6B3C]"
                    >
                      {reply.label}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-[13px] font-medium text-text">其他範本範例</p>
          <span className="text-[12px] text-secondary-text">更多範本 →</span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {LINE_AUTOMATION_TEMPLATE_CARDS.map((card) => (
            <button
              key={card.id}
              type="button"
              data-line-automation-template-card={card.id}
              onClick={() => onSelectTemplate?.(card.id)}
              className={cn(
                "overflow-hidden rounded-2xl border text-left transition-colors",
                selectedId === card.id
                  ? "border-primary bg-primary-light/40"
                  : "border-border bg-white hover:border-primary/40",
              )}
            >
              <div
                className="flex h-16 items-end px-2 pb-1.5 text-[12px] font-semibold text-[#7A4543]"
                style={{ background: card.accent }}
              >
                {card.title}
              </div>
              <p className="px-2 py-1.5 text-[11px] text-secondary-text">{card.caption}</p>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
