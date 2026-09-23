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

export type CategoryVisual = {
  image: string;
  caption: string;
  /** Branded artwork already contains copy — no overlay text/veil. */
  branded?: boolean;
  /** Intrinsic size for branded banners (width/height auto, no fill crop). */
  width?: number;
  height?: number;
};

export const CATEGORY_VISUALS: Record<
  "body-aroma" | "facial" | "crystal" | "bust" | "sculpting",
  CategoryVisual
> = {
  "body-aroma": {
    image: "/images/prices/body-aroma-banner.png",
    caption: "BODY & AROMA",
    branded: true,
    width: 1024,
    height: 576,
  },
  facial: {
    image: "/images/prices/facial-banner.png",
    caption: "FACIAL",
    branded: true,
    width: 1024,
    height: 576,
  },
  crystal: {
    image: "/images/prices/crystal-skin-banner.png",
    caption: "CRYSTAL SKIN",
    branded: true,
    width: 1024,
    height: 341,
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
};

export const NEW_GUEST_VISUAL =
  "https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=1600&q=80";

export const EDITORIAL_BREAK_IMAGES = [
  "https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=1800&q=80",
  "https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=1800&q=80",
  "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1800&q=80",
] as const;

export const FIRST_EXPERIENCE_IMAGE = NEW_GUEST_VISUAL;
