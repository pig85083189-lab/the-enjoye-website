"use client";

import Image from "next/image";
import { menuCategories } from "@/data/services";
import { Reveal } from "./Reveal";

type TreatmentArchGridProps = {
  onSelect: (categoryId: string) => void;
  onNewGuest: () => void;
};

export function TreatmentArchGrid({
  onSelect,
  onNewGuest,
}: TreatmentArchGridProps) {
  return (
    <section id="treatments" className="pm-arch" aria-labelledby="arch-heading">
      <Reveal>
        <div className="pm-arch__intro">
          <p className="pm-eyebrow">Our Treatments</p>
          <h2 id="arch-heading" className="pm-section-title">
            今天，想好好照顧哪一個自己？
          </h2>
          <p className="pm-section-note">
            從身體到心靈，
            <br />
            為你打造專屬的美好時光。
          </p>
        </div>
      </Reveal>

      <div className="pm-arch__grid">
        {menuCategories.map((item, index) => (
          <Reveal key={item.id} delayMs={(index % 5) * 60}>
            <button
              type="button"
              className="pm-arch__item"
              onClick={() => {
                if (item.id === "new-guest") onNewGuest();
                else onSelect(item.id);
              }}
            >
              <span className="pm-arch__frame">
                <Image
                  src={item.image}
                  alt={item.imageAlt}
                  fill
                  sizes="(max-width: 768px) 45vw, 160px"
                  className="pm-arch__image"
                />
              </span>
              <span className="pm-arch__name">{item.shortName}</span>
              <span className="pm-arch__en">{item.englishLabel}</span>
            </button>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
