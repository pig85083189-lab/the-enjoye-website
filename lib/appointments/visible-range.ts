/**
 * Pure layout helpers for calendar grid visible range.
 * Appointments outside the visible window must not be clamped to the top/bottom.
 */

export interface VisibleRangeLayoutInput {
  /** Absolute minutes from local midnight for block start */
  startMinutes: number;
  /** Absolute minutes from local midnight for block end */
  endMinutes: number;
  /** Grid visible window start (e.g. 9 * 60) */
  visibleStartMinutes: number;
  /** Grid visible window end (e.g. 21 * 60) */
  visibleEndMinutes: number;
  slotMinutes: number;
  slotPx: number;
}

export interface VisibleRangeLayout {
  /** False when the block does not intersect the visible window at all */
  visible: boolean;
  topPx: number;
  heightPx: number;
  clippedStart: boolean;
  clippedEnd: boolean;
}

/**
 * Layout a timed block inside a visible calendar window.
 * - Fully before / after → not visible (do not clamp to edges)
 * - Partial overlap → clipped rendering within the window
 * - Fully inside → normal placement
 */
export function layoutBlockInVisibleRange(
  input: VisibleRangeLayoutInput,
): VisibleRangeLayout {
  const {
    startMinutes,
    endMinutes,
    visibleStartMinutes,
    visibleEndMinutes,
    slotMinutes,
    slotPx,
  } = input;

  if (!(endMinutes > startMinutes)) {
    return {
      visible: false,
      topPx: 0,
      heightPx: 0,
      clippedStart: false,
      clippedEnd: false,
    };
  }

  // Fully outside — never clamp onto the grid edge
  if (endMinutes <= visibleStartMinutes || startMinutes >= visibleEndMinutes) {
    return {
      visible: false,
      topPx: 0,
      heightPx: 0,
      clippedStart: false,
      clippedEnd: false,
    };
  }

  const clippedStart = startMinutes < visibleStartMinutes;
  const clippedEnd = endMinutes > visibleEndMinutes;
  const renderStart = Math.max(startMinutes, visibleStartMinutes);
  const renderEnd = Math.min(endMinutes, visibleEndMinutes);
  const duration = renderEnd - renderStart;

  const topPx = ((renderStart - visibleStartMinutes) / slotMinutes) * slotPx;
  // Allow short clipped fragments; floor at half a slot so 15-min remnants stay hittable
  const heightPx = Math.max((slotPx / 2), (duration / slotMinutes) * slotPx);

  return {
    visible: true,
    topPx,
    heightPx,
    clippedStart,
    clippedEnd,
  };
}

export function absoluteMinutesFromDate(date: Date): number {
  return date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
}
