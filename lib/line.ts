/**
 * Official THE ENJOYE SPA LINE — single source for all public CTAs.
 * Set NEXT_PUBLIC_LINE_URL in .env.local (and hosting env).
 */

export const DEFAULT_LINE_URL = "https://line.me/R/ti/p/@tqv5049y";

export const LINE_URL =
  process.env.NEXT_PUBLIC_LINE_URL?.trim() || DEFAULT_LINE_URL;

export function openOfficialLine() {
  if (typeof window === "undefined") return;
  window.open(LINE_URL, "_blank", "noopener,noreferrer");
}
