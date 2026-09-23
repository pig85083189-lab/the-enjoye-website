"use client";

import { useEffect, useState } from "react";
import { menuCategories, type MenuCategoryId } from "@/data/services";

type CategoryNavProps = {
  onSelect: (categoryId: string) => void;
};

/** Nav-only Chinese labels — does not alter catalog data in services.ts */
const NAV_ZH: Record<MenuCategoryId, string> = {
  "new-guest": "新客專屬",
  "body-aroma": "身體 SPA・芳療",
  facial: "臉部保養",
  crystal: "矽晶煥膚",
  bust: "美胸 SPA",
  sculpting: "體雕・曲線管理",
};

const NAV_IDS = menuCategories.map((c) => c.id);

export function CategoryNav({ onSelect }: CategoryNavProps) {
  const [active, setActive] = useState<MenuCategoryId>("new-guest");

  useEffect(() => {
    const nodes = NAV_IDS.map((id) =>
      document.getElementById(`category-${id}`),
    ).filter(Boolean) as HTMLElement[];

    if (nodes.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        const top = visible[0];
        if (!top?.target.id) return;
        const id = top.target.id.replace("category-", "") as MenuCategoryId;
        if (NAV_IDS.includes(id)) setActive(id);
      },
      {
        rootMargin: "-35% 0px -45% 0px",
        threshold: [0.08, 0.2, 0.4],
      },
    );

    nodes.forEach((n) => observer.observe(n));
    return () => observer.disconnect();
  }, []);

  return (
    <nav
      id="treatments"
      className="pm-catnav"
      aria-label="療程分類導覽"
    >
      <div className="pm-catnav__track">
        {menuCategories.map((category) => {
          const isActive = active === category.id;
          const zh = NAV_ZH[category.id];
          return (
            <button
              key={category.id}
              type="button"
              className={`pm-catnav__item ${isActive ? "is-active" : ""}`}
              aria-current={isActive ? "true" : undefined}
              aria-label={`${category.englishLabel} ${zh}`}
              onClick={() => onSelect(category.id)}
            >
              <span className="pm-catnav__stack">
                <span className="pm-catnav__en">{category.englishLabel}</span>
                <span className="pm-catnav__zh">{zh}</span>
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
