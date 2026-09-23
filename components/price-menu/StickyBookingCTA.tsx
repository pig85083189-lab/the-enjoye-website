"use client";

type StickyBookingCTAProps = {
  onLine: () => void;
  onBook: () => void;
};

export function StickyBookingCTA({ onLine, onBook }: StickyBookingCTAProps) {
  return (
    <>
      <div className="pm-sticky" role="region" aria-label="預約與諮詢">
        <button
          type="button"
          className="pm-sticky__btn pm-sticky__btn--ghost"
          onClick={onLine}
        >
          LINE 諮詢
        </button>
        <span className="pm-sticky__sep" aria-hidden>
          |
        </span>
        <button
          type="button"
          className="pm-sticky__btn pm-sticky__btn--solid"
          onClick={onBook}
        >
          立即預約
        </button>
      </div>

      <button
        type="button"
        className="pm-float"
        onClick={onBook}
        aria-label="立即預約"
      >
        預約
      </button>
    </>
  );
}
