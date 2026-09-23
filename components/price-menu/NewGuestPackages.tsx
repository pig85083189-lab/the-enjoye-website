"use client";

import Image from "next/image";
import {
  formatDuration,
  formatPrice,
  getNewGuestPackages,
  type MenuService,
} from "@/data/services";
import { NEW_GUEST_VISUAL } from "@/data/price-visuals";
import { Reveal } from "./Reveal";

type NewGuestPackagesProps = {
  onLineConsult: () => void;
  onBook: () => void;
};

export function NewGuestPackages({
  onLineConsult,
  onBook,
}: NewGuestPackagesProps) {
  const packages = getNewGuestPackages();
  const [pkgA, pkgB] = packages;

  return (
    <section
      id="category-new-guest"
      className="pm-guest"
      aria-labelledby="new-guest-heading"
    >
      <Reveal>
        <header className="pm-guest__header">
          <p className="pm-guest__eyebrow">01 · FIRST EXPERIENCE</p>
          <h2 id="new-guest-heading" className="pm-guest__title">
            初次來訪
          </h2>
          <p className="pm-guest__sub">NEW GUEST EXCLUSIVE</p>
          <span className="pm-guest__rule" aria-hidden />
        </header>
      </Reveal>

      <div className="pm-guest__stage">
        <Reveal className="pm-guest__visual-wrap">
          <div className="pm-guest__visual">
            <Image
              src={NEW_GUEST_VISUAL}
              alt=""
              fill
              sizes="(max-width: 900px) 100vw, 42vw"
              className="pm-guest__image"
            />
            <div className="pm-guest__visual-veil" />
            <p className="pm-guest__visual-caption">NEW GUEST</p>
          </div>
        </Reveal>

        <div className="pm-guest__editorial">
          <Reveal>
            <p className="pm-guest__lead">
              第一次來 THE ENJOYE？
              <br />
              從專屬優惠開始，感受被好好照顧的時光。
            </p>
          </Reveal>

          <div className="pm-guest__offers" role="list">
            {pkgA ? (
              <Reveal delayMs={40}>
                <div role="listitem">
                  <GuestOffer
                    service={pkgA}
                    letter="A"
                    onLine={onLineConsult}
                    onBook={onBook}
                  />
                </div>
              </Reveal>
            ) : null}
            <span className="pm-guest__divider" aria-hidden />
            {pkgB ? (
              <Reveal delayMs={100}>
                <div role="listitem">
                  <GuestOffer
                    service={pkgB}
                    letter="B"
                    onLine={onLineConsult}
                    onBook={onBook}
                  />
                </div>
              </Reveal>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

type GuestOfferProps = {
  service: MenuService;
  letter: string;
  onLine: () => void;
  onBook: () => void;
};

function GuestOffer({ service, letter, onLine, onBook }: GuestOfferProps) {
  const duration = formatDuration(service.duration);

  return (
    <article className="pm-guest-offer">
      <p className="pm-guest-offer__letter">{letter}</p>
      <h3 className="pm-guest-offer__name">{service.name}</h3>
      <p className="pm-guest-offer__amount">
        {formatPrice(service.experiencePrice)}
      </p>
      <div className="pm-guest-offer__meta">
        <span className="pm-guest-offer__xp">體驗價</span>
        {duration ? (
          <span className="pm-guest-offer__duration">{duration}</span>
        ) : null}
      </div>
      <div className="pm-guest-offer__actions">
        <button type="button" className="pm-text-link" onClick={onBook}>
          立即預約
        </button>
        <button type="button" className="pm-text-link" onClick={onLine}>
          LINE 諮詢
        </button>
      </div>
    </article>
  );
}
