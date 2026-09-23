import type { Metadata } from "next";
import {
  Cormorant_Garamond,
  Noto_Sans_TC,
  Noto_Serif_TC,
} from "next/font/google";
import "./globals.css";

const displayFont = Cormorant_Garamond({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const serifFont = Noto_Serif_TC({
  variable: "--font-serif",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

const bodyFont = Noto_Sans_TC({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Beauty OS",
  description: "Beauty OS — multi-tenant SPA staff workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="zh-Hant"
      className={`${displayFont.variable} ${serifFont.variable} ${bodyFont.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-text antialiased">{children}</body>
    </html>
  );
}
