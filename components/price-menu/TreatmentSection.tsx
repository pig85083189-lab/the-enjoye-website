import Image from "next/image";
import {
  getServicesByCategory,
  type MenuCategory,
  type MenuCategoryId,
} from "@/data/services";
import { CATEGORY_VISUALS } from "@/data/price-visuals";
import { Reveal } from "./Reveal";
import { TreatmentRow } from "./TreatmentRow";

type TreatmentSectionProps = {
  category: MenuCategory;
  showVisual?: boolean;
};

export function TreatmentSection({
  category,
  showVisual = true,
}: TreatmentSectionProps) {
  const services = getServicesByCategory(category.id);
  const visual =
    category.id in CATEGORY_VISUALS
      ? CATEGORY_VISUALS[category.id as Exclude<MenuCategoryId, "new-guest">]
      : null;
  const branded = Boolean(visual?.branded);

  return (
    <section
      id={`category-${category.id}`}
      className="pm-treatment"
      aria-labelledby={`category-title-${category.id}`}
    >
      {showVisual && visual ? (
        <Reveal>
          <figure
            className={`pm-treatment__visual${branded ? " pm-treatment__visual--branded" : ""}`}
          >
            <Image
              src={visual.image}
              alt={branded ? "THE ENJOYE 矽晶煥膚" : ""}
              fill
              sizes="100vw"
              className="pm-treatment__visual-img"
              priority={category.id === "crystal"}
            />
            {!branded ? (
              <>
                <div className="pm-treatment__visual-veil" />
                <figcaption className="pm-treatment__visual-caption">
                  {visual.caption}
                </figcaption>
                <span className="pm-treatment__visual-frame" aria-hidden />
              </>
            ) : null}
          </figure>
        </Reveal>
      ) : null}

      <Reveal>
        <header className="pm-treatment__header">
          <p className="pm-treatment__order">
            <span className="pm-treatment__order-num">{category.orderLabel}</span>
            <span className="pm-treatment__order-sep" aria-hidden />
            <span className="pm-treatment__order-en">
              {category.englishLabel}
            </span>
          </p>
          <h2
            id={`category-title-${category.id}`}
            className="pm-treatment__title"
          >
            {category.name}
          </h2>
        </header>
      </Reveal>

      <div className="pm-treatment__menu" role="list">
        {services.length > 0 ? (
          services.map((service, index) => (
            <Reveal key={service.id} delayMs={Math.min(index * 28, 160)}>
              <div role="listitem">
                <TreatmentRow service={service} />
              </div>
            </Reveal>
          ))
        ) : (
          <p className="pm-treatment__empty">
            療程內容整理中，歡迎 LINE 詢問。
          </p>
        )}
      </div>
    </section>
  );
}
