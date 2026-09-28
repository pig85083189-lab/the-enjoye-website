/**
 * Shared calendar / location prototype business hours.
 * Staff working hours are a separate entity (Phase 4.8B).
 * Location opening hours remain a future LocationBusinessHours model.
 */
export const CALENDAR_DAY_START_HOUR = 9;
export const CALENDAR_DAY_END_HOUR = 21;
export const DEFAULT_SERVICE_DURATION_MINUTES = 60;
/** Scheduling grid resolution */
export const CALENDAR_SLOT_MINUTES = 30;
/**
 * Pixel height per 30-minute slot.
 * Measured from the Beauty OS Day View reference (1536×1024):
 * now-line 13:24 sits ~268px below the 09:00 grid line → ~30.5px / 30 min.
 */
export const CALENDAR_SLOT_PX = 30;
