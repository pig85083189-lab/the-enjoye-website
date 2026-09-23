"use client";

import type { TemplateBodyArea } from "@/types/treatment-template";
import { cn } from "@/lib/utils";

const LINE = "#D8C8C4";
const ACTIVE = "#C9797D";
const ACTIVE_BG = "#F5E5E3";

const CIRCLED = ["①", "②", "③", "④", "⑤", "⑥", "⑦", "⑧", "⑨", "⑩", "⑪", "⑫"];

interface BreastBodyMapSvgProps {
  areas: TemplateBodyArea[];
  selectedAreaId: string | null;
  /** areaId → 0-based marker index */
  markerIndexByArea: Map<string, number>;
  onSelectArea: (areaId: string) => void;
}

/**
 * Front-view upper torso for breast SPA charting.
 * Guest RIGHT = screen LEFT; guest LEFT = screen RIGHT.
 */
export function BreastBodyMapSvg({
  areas,
  selectedAreaId,
  markerIndexByArea,
  onSelectArea,
}: BreastBodyMapSvgProps) {
  return (
    <svg
      viewBox="0 0 200 280"
      className="mx-auto h-auto w-full max-w-[360px]"
      role="img"
      aria-label="女性上半身簡約部位圖，左右以客人本人方向為準"
    >
      {/* Soft fill */}
      <path
        d="M78 48
           C70 58 58 72 48 92
           C40 110 36 130 38 150
           C40 190 48 220 62 238
           C78 255 92 258 100 258
           C108 258 122 255 138 238
           C152 220 160 190 162 150
           C164 130 160 110 152 92
           C142 72 130 58 122 48
           C114 38 106 34 100 34
           C94 34 86 38 78 48 Z"
        fill="#FAF7F5"
        stroke={LINE}
        strokeWidth="1.5"
      />

      {/* Neck */}
      <path
        d="M88 34 C90 28 94 24 100 24 C106 24 110 28 112 34"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Shoulders */}
      <path
        d="M78 52 C58 58 42 74 32 96"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M122 52 C142 58 158 74 168 96"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Clavicles */}
      <path
        d="M72 78 C84 70 100 68 100 68"
        fill="none"
        stroke={LINE}
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      <path
        d="M128 78 C116 70 100 68 100 68"
        fill="none"
        stroke={LINE}
        strokeWidth="1.2"
        strokeLinecap="round"
      />

      {/* Upper arms */}
      <path
        d="M32 96 C22 118 20 145 24 172"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M168 96 C178 118 180 145 176 172"
        fill="none"
        stroke={LINE}
        strokeWidth="1.5"
        strokeLinecap="round"
      />

      {/* Soft breast contours — abstract only */}
      <path
        d="M68 128 C78 118 90 122 98 138 C90 152 78 160 68 152 C62 144 62 134 68 128 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.25"
      />
      <path
        d="M132 128 C122 118 110 122 102 138 C110 152 122 160 132 152 C138 144 138 134 132 128 Z"
        fill="none"
        stroke={LINE}
        strokeWidth="1.25"
      />

      {/* Sternum guide */}
      <path
        d="M100 108 L100 188"
        fill="none"
        stroke={LINE}
        strokeWidth="1"
        strokeDasharray="3 4"
        opacity="0.7"
      />

      {/* Armpit hollow hints */}
      <path
        d="M48 108 C54 114 56 122 54 130"
        fill="none"
        stroke={LINE}
        strokeWidth="1"
        opacity="0.8"
      />
      <path
        d="M152 108 C146 114 144 122 146 130"
        fill="none"
        stroke={LINE}
        strokeWidth="1"
        opacity="0.8"
      />

      {areas.map((area) => {
        const cx = area.cx ?? 100;
        const cy = area.cy ?? 150;
        const r = Math.max(area.r ?? 16, 16);
        const active = selectedAreaId === area.id;
        const markerIndex = markerIndexByArea.get(area.id);
        const marked = markerIndex !== undefined;

        return (
          <g key={area.id}>
            <circle
              cx={cx}
              cy={cy}
              r={r}
              fill={active ? ACTIVE_BG : marked ? "rgba(201,121,125,0.16)" : "transparent"}
              stroke={active || marked ? ACTIVE : "transparent"}
              strokeWidth={active ? 2 : 1.5}
              className="cursor-pointer"
              tabIndex={0}
              role="button"
              aria-label={`標記${area.label}`}
              aria-pressed={marked || active}
              onClick={() => onSelectArea(area.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onSelectArea(area.id);
                }
              }}
            />
            {marked ? (
              <text
                x={cx}
                y={cy + 1}
                textAnchor="middle"
                dominantBaseline="middle"
                className={cn("pointer-events-none select-none")}
                fill={ACTIVE}
                fontSize="13"
                fontWeight="600"
              >
                {CIRCLED[markerIndex] ?? String(markerIndex + 1)}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export { CIRCLED as BODY_MAP_CIRCLED_NUMBERS };
