import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Beauty OS",
  description: "Beauty OS — multi-tenant SPA staff workspace",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="zh-Hant" className="h-full antialiased">
      <body className="min-h-full font-sans text-text antialiased">{children}</body>
    </html>
  );
}
