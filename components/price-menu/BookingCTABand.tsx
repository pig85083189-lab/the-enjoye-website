"use client";

import { Reveal } from "./Reveal";

type BookingCTABandProps = {
  onLine: () => void;
  onBook: () => void;
};

export function BookingCTABand({ onLine, onBook }: BookingCTABandProps) {
  return (
    <Reveal>
      <section className="pm-band" aria-label="諮詢與預約">
        <div className="pm-band__grid">
          <button type="button" className="pm-band__card" onClick={onLine}>
            <span className="pm-band__icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <path
                  d="M12 3C6.48 3 2 6.7 2 11.2c0 2.5 1.4 4.7 3.6 6.2-.1.8-.5 2.2-1.8 3.7 2.1-.2 3.7-1.1 4.7-1.8 1.1.3 2.3.5 3.5.5 5.52 0 10-3.7 10-8.2S17.52 3 12 3Z"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </span>
            <span className="pm-band__title">LINE 諮詢</span>
            <span className="pm-band__text">專人為你解答課程相關問題</span>
          </button>

          <span className="pm-band__divider" aria-hidden>
            |
          </span>

          <button type="button" className="pm-band__card" onClick={onBook}>
            <span className="pm-band__icon" aria-hidden>
              <svg viewBox="0 0 24 24" width="22" height="22" fill="none">
                <rect
                  x="3.5"
                  y="5"
                  width="17"
                  height="15"
                  rx="1"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
                <path
                  d="M3.5 9.5h17M8 3.5v3M16 3.5v3"
                  stroke="currentColor"
                  strokeWidth="1.2"
                />
              </svg>
            </span>
            <span className="pm-band__title">立即預約</span>
            <span className="pm-band__text">預約屬於你的療癒時光</span>
          </button>

          <p className="pm-band__script">
            A Better You
            <br />
            Every Day
          </p>
        </div>
      </section>
    </Reveal>
  );
}
