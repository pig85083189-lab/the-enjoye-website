"use client";

import { useEffect, useState } from "react";
import { openOfficialLine } from "@/lib/line";

type PriceNavbarProps = {
  onOpenMenu?: () => void;
};

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

export function PriceNavbar({ onOpenMenu }: PriceNavbarProps) {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const go = (id: string) => {
    setMenuOpen(false);
    scrollToId(id);
  };

  return (
    <header className={`pm-nav-bar ${scrolled ? "is-scrolled" : ""}`}>
      <div className="pm-nav-bar__inner">
        <button
          type="button"
          className="pm-nav-bar__brand"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        >
          THE ENJOYE
        </button>

        <nav className="pm-nav-bar__links" aria-label="主要導覽">
          <button type="button" onClick={() => go("treatments")}>
            課程價目
          </button>
          <button type="button" onClick={() => go("brand-ethos")}>
            品牌理念
          </button>
          <button type="button" onClick={() => go("faq")}>
            常見問題
          </button>
          <button
            type="button"
            className="pm-nav-bar__book"
            onClick={openOfficialLine}
          >
            立即預約
          </button>
        </nav>

        <button
          type="button"
          className="pm-nav-bar__menu"
          aria-label={menuOpen ? "關閉選單" : "開啟選單"}
          aria-expanded={menuOpen}
          onClick={() => {
            setMenuOpen((v) => !v);
            onOpenMenu?.();
          }}
        >
          <span />
          <span />
          <span />
        </button>
      </div>

      {menuOpen ? (
        <div className="pm-nav-bar__drawer">
          <button type="button" onClick={() => go("treatments")}>
            課程價目
          </button>
          <button type="button" onClick={() => go("brand-ethos")}>
            品牌理念
          </button>
          <button type="button" onClick={() => go("faq")}>
            常見問題
          </button>
          <button type="button" onClick={openOfficialLine}>
            立即預約
          </button>
          <button type="button" onClick={openOfficialLine}>
            LINE 諮詢
          </button>
        </div>
      ) : null}
    </header>
  );
}
