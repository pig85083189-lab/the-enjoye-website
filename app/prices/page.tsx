import type { Metadata } from "next";
import { BRAND } from "@/data/services";
import { PriceMenuPage } from "@/components/price-menu/PriceMenuPage";
import "./prices.css";

const title = "THE ENJOYE SPA｜課程價目表";
const description =
  "THE ENJOYE SPA 體驗價目表。新客專屬套餐、身體芳療、臉部保養、矽晶煥膚、美胸 SPA 與體雕曲線，歡迎 LINE 諮詢預約。";
const canonical = `${BRAND.siteUrl}${BRAND.canonicalPath}`;
const ogImage =
  "https://images.unsplash.com/photo-1544161515-4ab6ce6db874?auto=format&fit=crop&w=1200&q=80";

export const metadata: Metadata = {
  title,
  description,
  alternates: {
    canonical,
  },
  openGraph: {
    title,
    description,
    url: canonical,
    siteName: BRAND.name,
    locale: "zh_TW",
    type: "website",
    images: [
      {
        url: ogImage,
        width: 1200,
        height: 630,
        alt: "THE ENJOYE SPA",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: [ogImage],
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function PricesPage() {
  return <PriceMenuPage />;
}
