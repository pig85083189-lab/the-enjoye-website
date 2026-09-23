"use client";

import Image from "next/image";
import { menuCategories } from "@/data/services";
import { Reveal } from "./Reveal";

type TreatmentEditorialGridProps = {
  onSelect: (categoryId: string) => void;
};

export function TreatmentEditorialGrid({ onSelect }: TreatmentEditorialGridProps) {
  return (
    <section id="rituals" className="pm-editorial" aria-labelledby="rituals-heading">
      <Reveal>
        <div className="pm-section-intro">
          <p className="pm-eyebrow">Choose Your Ritual</p>
          <h2 id="rituals-heading" className="pm-section-title">
            今天，
            <br />
            想好好照顧哪一個自己？
          </h2>
        </div>
      </Reveal>

      <div className="pm-editorial__grid">
        {menuCategories.map((category, index) => (
          <Reveal key={category.id} delayMs={(index % 3) * 80}>
            <article
              className={`pm-editorial__card pm-editorial__card--${category.layout} pm-editorial__card--i${index}`}
            >
              <button
                type="button"
                className="pm-editorial__hit"
                onClick={() => onSelect(category.id)}
                aria-label={`探索${category.name}`}
              >
                <div className="pm-editorial__media">
                  <Image
                    src={category.image}
                    alt={category.imageAlt}
                    fill
                    sizes="(max-width: 768px) 100vw, 42vw"
                    className="pm-editorial__image"
                  />
                </div>
                <div className="pm-editorial__copy">
                  <p className="pm-eyebrow">{category.englishLabel}</p>
                  <h3 className="pm-editorial__name">{category.name}</h3>
                  <p className="pm-editorial__mood">{category.moodLine}</p>
                  <span className="pm-link">Explore →</span>
                </div>
              </button>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}
