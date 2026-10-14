export function LineBroadcastPhonePreview({
  officialName,
  textBody,
}: {
  officialName: string;
  textBody: string;
}) {
  return (
    <div data-line-phone-preview className="mx-auto w-[260px]">
      <div className="overflow-hidden rounded-[1.75rem] border border-border bg-[#1a1a1a] p-2 shadow-[0_8px_24px_rgba(48,43,43,0.08)]">
        <div className="overflow-hidden rounded-[1.35rem] bg-[#74828F]">
          <div className="bg-[#06C755] px-3 py-2.5 text-white">
            <p className="text-[10px] tracking-[0.14em] text-white/80">LINE</p>
            <p className="truncate text-[13px] font-semibold">{officialName}</p>
          </div>
          <div className="min-h-52 space-y-2 px-3 py-3">
            <div className="max-w-[88%] rounded-2xl rounded-tl-md bg-white px-3 py-2 text-[13px] leading-relaxed text-text whitespace-pre-wrap">
              {textBody || "尚未輸入文字"}
            </div>
          </div>
        </div>
      </div>
      <p className="mt-2 text-center text-[12px] text-secondary-text">手機版訊息預覽</p>
    </div>
  );
}
