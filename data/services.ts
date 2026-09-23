/**
 * THE ENJOYE SPA — public /prices catalog.
 * Source of truth: store-confirmed experience menu (do not invent names, durations, or prices).
 * Guest-facing amount field: experiencePrice. price kept with the same value for compatibility.
 * /prices UI shows experience price only (never regular / original price).
 */

import { LINE_URL } from "@/lib/line";

export const BRAND = {
  name: "THE ENJOYE SPA",
  tagline: "Beauty \u00B7 Body \u00B7 Mind \u00B7 Life",
  pageLabel: "課程價目表",
  headline: "把時間留給自己，從今天最想被照顧的地方開始。",
  subhead: "從身體、肌膚到心情，\n為自己留下一段真正被照顧的時間。",
  lineUrl: LINE_URL,
  siteUrl: "https://theenjoye.com",
  canonicalPath: "/prices",
} as const;

export type MenuCategoryId =
  | "new-guest"
  | "body-aroma"
  | "facial"
  | "crystal"
  | "bust"
  | "sculpting";

export type MenuCategory = {
  id: MenuCategoryId;
  englishLabel: string;
  orderLabel: string;
  name: string;
  shortName: string;
  moodLine: string;
  description: string;
  image: string;
  imageAlt: string;
  layout: "tall" | "wide" | "square";
};

export type MenuService = {
  id: string;
  category: MenuCategoryId;
  categoryId: MenuCategoryId;
  name: string;
  duration: number | null;
  price: number | null;
  experiencePrice: number | null;
  description: string;
  published: boolean;
  featured?: boolean;
};

export const menuCategories: MenuCategory[] = [
  {
    id: "new-guest",
    englishLabel: "NEW GUEST",
    orderLabel: "01",
    name: "新客專屬套餐",
    shortName: "新客專屬",
    moodLine: "第一次來，從專屬優惠開始。",
    description: "專為新客準備的體驗套餐，輕鬆認識 THE ENJOYE。",
    image: "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=80",
    imageAlt: "THE ENJOYE 新客專屬優惠",
    layout: "wide",
  },
  {
    id: "body-aroma",
    englishLabel: "BODY & AROMA",
    orderLabel: "02",
    name: "身體 SPA / 芳療",
    shortName: "身體芳療",
    moodLine: "讓身體先慢下來。",
    description: "以溫感、芳療與排濕淨化，照顧身體日常節奏。",
    image: "https://images.unsplash.com/photo-1600334089648-b0d9d3028eb2?auto=format&fit=crop&w=1200&q=80",
    imageAlt: "身體 SPA 與芳療護理",
    layout: "tall",
  },
  {
    id: "facial",
    englishLabel: "FACIAL",
    orderLabel: "03",
    name: "臉部保養",
    shortName: "臉部保養",
    moodLine: "肌膚，值得被細心對待。",
    description: "從毛孔淨化到緊緻亮澤，依膚況層層呵護。",
    image: "https://images.unsplash.com/photo-1487412947147-5cebf100ffc2?auto=format&fit=crop&w=1200&q=80",
    imageAlt: "臉部保養護理",
    layout: "square",
  },
  {
    id: "crystal",
    englishLabel: "CRYSTAL SKIN",
    orderLabel: "04",
    name: "矽晶煥膚",
    shortName: "矽晶煥膚",
    moodLine: "細緻煥新，從膚觸開始。",
    description: "矽晶煥膚系列，照顧胸背與臉部膚況。",
    image: "https://images.unsplash.com/photo-1515377905703-c4788e51af15?auto=format&fit=crop&w=1200&q=80",
    imageAlt: "矽晶煥膚護理",
    layout: "wide",
  },
  {
    id: "bust",
    englishLabel: "BUST CARE",
    orderLabel: "05",
    name: "美胸 SPA",
    shortName: "美胸 SPA",
    moodLine: "柔軟、緊實，與漂亮曲線。",
    description: "美胸保養與曲線呵護，留給自己一段細緻時間。",
    image: "https://images.unsplash.com/photo-1540555700478-4be289fbecef?auto=format&fit=crop&w=1200&q=80",
    imageAlt: "美胸 SPA 護理",
    layout: "tall",
  },
  {
    id: "sculpting",
    englishLabel: "BODY SCULPTING",
    orderLabel: "06",
    name: "體雕 / 曲線管理",
    shortName: "體雕曲線",
    moodLine: "線條，是被好好照顧後的結果。",
    description: "針對肩背腰臀腿，溫柔雕塑日常體態。",
    image: "https://images.unsplash.com/photo-1507652313519-d4e9174996dd?auto=format&fit=crop&w=1200&q=80",
    imageAlt: "體雕與曲線管理",
    layout: "square",
  },
];

export const menuServices: MenuService[] = [
  {
    id: "pkg-a",
    category: "new-guest",
    categoryId: "new-guest",
    name: "A套餐（新客專屬優惠）",
    duration: 90,
    price: 2499,
    experiencePrice: 2499,
    description: "",
    published: true,
    featured: true,
  },
  {
    id: "pkg-b",
    category: "new-guest",
    categoryId: "new-guest",
    name: "B套餐（新客專屬優惠）",
    duration: 90,
    price: 1999,
    experiencePrice: 1999,
    description: "",
    published: true,
    featured: true,
  },
  {
    id: "ba-hot-stone",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "暖呼呼熱石循環SPA",
    duration: 100,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-lymph",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "淋巴排毒代謝SPA",
    duration: 100,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-acid",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "深層排酸淨化SPA",
    duration: 100,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-aroma-relax",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "芳療舒壓放鬆SPA",
    duration: 60,
    price: 1399,
    experiencePrice: 1399,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-full-heal",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "身心療癒全身SPA",
    duration: 80,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-sweat",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "全身爆汗排毒SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-cupping",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "暖呼呼暖心排濕溫罐SPA",
    duration: 100,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-ear-candle",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "耳燭舒眠放鬆SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-head",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "頭療減壓SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-scrub",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "全身美白光滑去角質SPA",
    duration: 60,
    price: 1199,
    experiencePrice: 1199,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-mud",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "全身排毒黑泥淨化SPA",
    duration: 40,
    price: 899,
    experiencePrice: 899,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-navel",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "臍燭腸道排濕SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "ba-womb",
    category: "body-aroma",
    categoryId: "body-aroma",
    name: "暖宮活力回春SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-pore-refine",
    category: "facial",
    categoryId: "facial",
    name: "毛孔細緻淨膚護理",
    duration: 90,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-zero-pore",
    category: "facial",
    categoryId: "facial",
    name: "零毛孔美肌煥顏護理",
    duration: 90,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-hydro-clean",
    category: "facial",
    categoryId: "facial",
    name: "水飛梭毛孔潔淨護理",
    duration: 90,
    price: 1399,
    experiencePrice: 1399,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-hydro-moist",
    category: "facial",
    categoryId: "facial",
    name: "水飛梭毛孔保濕護理",
    duration: 100,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-lift",
    category: "facial",
    categoryId: "facial",
    name: "緊緻小臉撥筋護理",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-eye",
    category: "facial",
    categoryId: "facial",
    name: "珍珠亮眼舒壓護理",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-vline",
    category: "facial",
    categoryId: "facial",
    name: "少女V型緊緻護理",
    duration: 90,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-gold",
    category: "facial",
    categoryId: "facial",
    name: "逆時光女神黃金透亮護理",
    duration: 90,
    price: 2299,
    experiencePrice: 2299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "fc-ha",
    category: "facial",
    categoryId: "facial",
    name: "玻尿酸保濕護理",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "cr-bust-axilla",
    category: "crystal",
    categoryId: "crystal",
    name: "矽晶嫩白美胸煥膚（含腋下）",
    duration: null,
    price: 1999,
    experiencePrice: 1999,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "cr-back",
    category: "crystal",
    categoryId: "crystal",
    name: "矽晶美背無暇煥膚",
    duration: 60,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "cr-face-60",
    category: "crystal",
    categoryId: "crystal",
    name: "矽晶擦擦筆臉部煥膚",
    duration: 60,
    price: 1599,
    experiencePrice: 1599,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "cr-face-90",
    category: "crystal",
    categoryId: "crystal",
    name: "矽晶擦擦筆臉部煥膚",
    duration: 90,
    price: 1999,
    experiencePrice: 1999,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "bu-post-op",
    category: "bust",
    categoryId: "bust",
    name: "隆乳術後美胸保養SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "bu-lift",
    category: "bust",
    categoryId: "bust",
    name: "緊緻拉提美波 SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "bu-round",
    category: "bust",
    categoryId: "bust",
    name: "渾圓天成美波 SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "bu-upup",
    category: "bust",
    categoryId: "bust",
    name: "美波澎潤UPUP SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-arms",
    category: "sculpting",
    categoryId: "sculpting",
    name: "告別掰掰蝴蝶袖SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-hip",
    category: "sculpting",
    categoryId: "sculpting",
    name: "微笑蜜桃翹臀2.0 SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-chanel",
    category: "sculpting",
    categoryId: "sculpting",
    name: "CHANEL美人小香肩SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-back",
    category: "sculpting",
    categoryId: "sculpting",
    name: "BANG!小心肝薄背SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-waist",
    category: "sculpting",
    categoryId: "sculpting",
    name: "超腰瘦極致曲線SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-full",
    category: "sculpting",
    categoryId: "sculpting",
    name: "完美比例體態SPA",
    duration: 90,
    price: 1999,
    experiencePrice: 1999,
    description: "",
    published: true,
    featured: false,
  },
  {
    id: "sc-legs",
    category: "sculpting",
    categoryId: "sculpting",
    name: "纖細誘人鉛筆腿SPA",
    duration: 60,
    price: 1299,
    experiencePrice: 1299,
    description: "",
    published: true,
    featured: false,
  },
];

export function getPublishedServices(): MenuService[] {
  return menuServices.filter((s) => s.published);
}

export function getServicesByCategory(
  categoryId: MenuCategoryId,
): MenuService[] {
  return getPublishedServices().filter((s) => s.categoryId === categoryId);
}

export function getNewGuestPackages(): MenuService[] {
  return getServicesByCategory("new-guest");
}

export function hasExperiencePrice(service: MenuService): boolean {
  return service.experiencePrice != null;
}

export function getCategoryName(categoryId: MenuCategoryId): string {
  return menuCategories.find((c) => c.id === categoryId)?.name ?? "";
}

export function formatDuration(minutes: number | null): string {
  if (minutes == null) return "";
  return `${minutes} MIN`;
}

/** Money only — prefix with 體驗價 in UI. */
export function formatPrice(price: number | null): string {
  if (price == null) return "請洽詢";
  return `NT$ ${price.toLocaleString("en-US")}`;
}

export function countPublishedByCategory(): Record<MenuCategoryId, number> {
  const counts = {
    "new-guest": 0,
    "body-aroma": 0,
    facial: 0,
    crystal: 0,
    bust: 0,
    sculpting: 0,
  } satisfies Record<MenuCategoryId, number>;
  for (const s of getPublishedServices()) {
    counts[s.categoryId] += 1;
  }
  return counts;
}
