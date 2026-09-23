"use client";

import Image from "next/image";
import { HERO_IMAGES } from "@/data/price-visuals";

type PriceHeroProps = {
  onExplore: () => void;
};

export function PriceHero({ onExplore }: PriceHeroProps) {
  return (
    <section className="pm-hero" aria-label="THE ENJOYE SPA">
      {/* Desktop asymmetric editorial triptych */}
      <div className="pm-hero__desktop">
        <figure className="pm-hero__col pm-hero__col--a">
          <Image
            src={HERO_IMAGES.left}
            alt=""
            fill
            sizes="26vw"
            className="pm-hero__img"
            priority
          />
          <div className="pm-hero__veil" />
          <span className="pm-hero__frame" aria-hidden />
        </figure>

        <figure className="pm-hero__col pm-hero__col--b">
          <Image
            src={HERO_IMAGES.center}
            alt="THE ENJOYE SPA"
            fill
            sizes="48vw"
            className="pm-hero__img"
            priority
          />
          <div className="pm-hero__veil pm-hero__veil--center" />
          <div className="pm-hero__center">
            <p className="pm-hero__brand-mark">T H E &nbsp; E N J O Y E</p>
            <h1 className="pm-hero__title">
              <span>THE ENJOYE</span>
              <span>SPA</span>
            </h1>
            <span className="pm-hero__rule" aria-hidden />
            <p className="pm-hero__course-en">COURSE MENU</p>
            <p className="pm-hero__course-zh">課程價目表</p>
          </div>
          <span className="pm-hero__hairline pm-hero__hairline--l" aria-hidden />
          <span className="pm-hero__hairline pm-hero__hairline--r" aria-hidden />
        </figure>

        <figure className="pm-hero__col pm-hero__col--c">
          <Image
            src={HERO_IMAGES.right}
            alt=""
            fill
            sizes="26vw"
            className="pm-hero__img"
            priority
          />
          <div className="pm-hero__veil" />
          <span className="pm-hero__frame" aria-hidden />
        </figure>
      </div>

      {/* Mobile: dominant frame + collage strip */}
      <div className="pm-hero__mobile">
        <div className="pm-hero__mobile-main">
          <Image
            src={HERO_IMAGES.center}
            alt="THE ENJOYE SPA"
            fill
            sizes="100vw"
            className="pm-hero__img"
            priority
          />
          <div className="pm-hero__veil pm-hero__veil--center" />
          <div className="pm-hero__center pm-hero__center--mobile">
            <p className="pm-hero__brand-mark">T H E &nbsp; E N J O Y E</p>
            <h1 className="pm-hero__title">
              <span>THE ENJOYE</span>
              <span>SPA</span>
            </h1>
            <span className="pm-hero__rule" aria-hidden />
            <p className="pm-hero__course-en">COURSE MENU</p>
            <p className="pm-hero__course-zh">課程價目表</p>
          </div>
        </div>
        <div className="pm-hero__mobile-strip" aria-hidden>
          <div className="pm-hero__mobile-tile pm-hero__mobile-tile--tall">
            <Image
              src={HERO_IMAGES.left}
              alt=""
              fill
              sizes="55vw"
              className="pm-hero__img"
            />
          </div>
          <div className="pm-hero__mobile-tile">
            <Image
              src={HERO_IMAGES.right}
              alt=""
              fill
              sizes="45vw"
              className="pm-hero__img"
            />
          </div>
        </div>
      </div>

      <button
        type="button"
        className="pm-hero__scroll"
        onClick={onExplore}
        aria-label="向下瀏覽"
      >
        <span className="pm-hero__scroll-line" aria-hidden />
      </button>
    </section>
  );
}
