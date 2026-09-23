/**
 * Curated SPA photography for the public price menu.
 * Visual assets only — does not affect catalog data in services.ts.
 */

export const HERO_IMAGES = {
  left:
    "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1400&q=80",
  center:
    "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1600&q=80",
  right:
    "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80",
} as const;

export const CATEGORY_VISUALS = {
  "body-aroma": {
    image:
      "https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=1800&q=80",
    caption: "BODY & AROMA",
  },
  facial: {
    image:
      "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1800&q=80",
    caption: "FACIAL",
  },
  crystal: {
    image:
      "https://images.unsplash.com/photo-1570172619644-dfd03ed85f47?auto=format&fit=crop&w=1800&q=80",
    caption: "CRYSTAL SKIN",
  },
  bust: {
    image:
      "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1800&q=80",
    caption: "BUST CARE",
  },
  sculpting: {
    image:
      "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1800&q=80",
    caption: "BODY SCULPTING",
  },
} as const;

export const NEW_GUEST_VISUAL =
  "https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=1600&q=80";

export const EDITORIAL_BREAK_IMAGES = [
  "https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=1800&q=80",
  "https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=1800&q=80",
  "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1800&q=80",
] as const;

export const FIRST_EXPERIENCE_IMAGE = NEW_GUEST_VISUAL;
