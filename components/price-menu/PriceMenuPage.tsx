"use client";

import { useCallback } from "react";
import { BRAND, menuCategories } from "@/data/services";
import { openOfficialLine } from "@/lib/line";
import { BookingCTABand } from "./BookingCTABand";
import { CategoryNav } from "./CategoryNav";
import { NewGuestPackages } from "./NewGuestPackages";
import { PriceHero } from "./PriceHero";
import { PriceIntro } from "./PriceIntro";
import { PriceNavbar } from "./PriceNavbar";
import { StickyBookingCTA } from "./StickyBookingCTA";
import { TreatmentSection } from "./TreatmentSection";
import { Reveal } from "./Reveal";

function scrollToId(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
}

export function PriceMenuPage() {
  const goCategory = useCallback((categoryId: string) => {
    scrollToId(`category-${categoryId}`);
  }, []);

  const goIntro = useCallback(() => scrollToId("intro"), []);

  const catalogCategories = menuCategories.filter((c) => c.id !== "new-guest");

  return (
    <div className="pm-page">
      <PriceNavbar />
      <PriceHero onExplore={goIntro} />

      <div className="pm-shell">
        <div id="intro">
          <PriceIntro />
        </div>

        <CategoryNav onSelect={goCategory} />

        <div id="price-list" className="pm-price-list">
          <NewGuestPackages
            onLineConsult={openOfficialLine}
            onBook={openOfficialLine}
          />

          {catalogCategories.map((category) => (
            <TreatmentSection key={category.id} category={category} />
          ))}
        </div>

        <BrandEthos />
        <FaqSection />

        <BookingCTABand
          onLine={openOfficialLine}
          onBook={openOfficialLine}
        />

        <footer className="pm-footer">
          <p className="pm-footer__brand">{BRAND.name}</p>
          <p className="pm-footer__tag">{BRAND.tagline}</p>
          <p className="pm-footer__copy">讓美麗，成為日常。</p>
          <button
            type="button"
            className="pm-footer__line"
            onClick={openOfficialLine}
          >
            加入官方 LINE
          </button>
        </footer>
      </div>

      <StickyBookingCTA
        onLine={openOfficialLine}
        onBook={openOfficialLine}
      />
    </div>
  );
}

function BrandEthos() {
  return (
    <Reveal>
      <section id="brand-ethos" className="pm-ethos" aria-labelledby="ethos-heading">
        <p className="pm-eyebrow">Brand ethos</p>
        <h2 id="ethos-heading" className="pm-section-title">
          品牌理念
        </h2>
        <p className="pm-ethos__text">
          THE ENJOYE 相信，美麗不是急著改變自己，
          而是願意留給自己一段被好好照顧的時間。
          從身體、肌膚到心情，我們以安靜、細緻的節奏，
          陪妳找回日常裡的柔軟與自信。
        </p>
      </section>
    </Reveal>
  );
}

function FaqSection() {
  const faqs = [
    {
      q: "第一次來需要做什麼準備？",
      a: "告訴我們妳最近最在意的狀態即可。美容師會協助建議適合的療程方向。也可以先從新客專屬套餐開始體驗。",
    },
    {
      q: "可以先諮詢再預約嗎？",
      a: "可以。歡迎透過 LINE 先詢問，我們會協助妳了解課程、時間與適合的選擇。",
    },
    {
      q: "價目表上的體驗價是什麼意思？",
      a: "目前頁面上的金額皆為 THE ENJOYE SPA 體驗價。若不確定適合哪一堂，歡迎透過 LINE 詢問美容師。",
    },
  ];

  return (
    <Reveal>
      <section id="faq" className="pm-faq" aria-labelledby="faq-heading">
        <p className="pm-eyebrow">FAQ</p>
        <h2 id="faq-heading" className="pm-section-title">
          常見問題
        </h2>
        <div className="pm-faq__list">
          {faqs.map((item) => (
            <div key={item.q} className="pm-faq__item">
              <h3 className="pm-faq__q">{item.q}</h3>
              <p className="pm-faq__a">{item.a}</p>
            </div>
          ))}
        </div>
      </section>
    </Reveal>
  );
}
