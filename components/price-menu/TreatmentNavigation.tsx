"use client";

import { menuCategories } from "@/data/services";
import { Reveal } from "./Reveal";

type TreatmentNavigationProps = {
  onSelect: (categoryId: string) => void;
};

export function TreatmentNavigation({ onSelect }: TreatmentNavigationProps) {
  return (
    <Reveal>
      <nav id="quick-nav" className="pm-nav" aria-label="療程分類快速導覽">
        <p className="pm-eyebrow">Browse</p>
        <ul className="pm-nav__list">
          {menuCategories.map((category) => (
            <li key={category.id}>
              <button
                type="button"
                className="pm-nav__item"
                onClick={() => onSelect(category.id)}
              >
                {category.shortName}
              </button>
            </li>
          ))}
        </ul>
      </nav>
    </Reveal>
  );
}
