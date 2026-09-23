import { describe, expect, it } from "vitest";
import {
  layoutBlockInVisibleRange,
  type VisibleRangeLayoutInput,
} from "./visible-range";

const BASE: Omit<VisibleRangeLayoutInput, "startMinutes" | "endMinutes"> = {
  visibleStartMinutes: 9 * 60,
  visibleEndMinutes: 21 * 60,
  slotMinutes: 30,
  slotPx: 28,
};

describe("layoutBlockInVisibleRange", () => {
  it("hides appointment fully before visible range (e.g. 07:00–08:00)", () => {
    const layout = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 7 * 60,
      endMinutes: 8 * 60,
    });
    expect(layout.visible).toBe(false);
    expect(layout.topPx).toBe(0);
  });

  it("hides appointment fully after visible range (e.g. 21:30–22:30)", () => {
    const layout = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 21 * 60 + 30,
      endMinutes: 22 * 60 + 30,
    });
    expect(layout.visible).toBe(false);
  });

  it("clips appointment overlapping visible start (e.g. 08:00–10:00)", () => {
    const layout = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 8 * 60,
      endMinutes: 10 * 60,
    });
    expect(layout.visible).toBe(true);
    expect(layout.clippedStart).toBe(true);
    expect(layout.clippedEnd).toBe(false);
    // Visible fragment 09:00–10:00 = 60 min = 2 slots → top 0, height 56
    expect(layout.topPx).toBe(0);
    expect(layout.heightPx).toBe(56);
  });

  it("clips appointment overlapping visible end (e.g. 20:00–22:00)", () => {
    const layout = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 20 * 60,
      endMinutes: 22 * 60,
    });
    expect(layout.visible).toBe(true);
    expect(layout.clippedStart).toBe(false);
    expect(layout.clippedEnd).toBe(true);
    // 20:00 is 11h after 09:00 = 22 slots * 28 = 616
    expect(layout.topPx).toBe(616);
    // Visible fragment 20:00–21:00 = 60 min
    expect(layout.heightPx).toBe(56);
  });

  it("places appointment fully inside range (e.g. 14:00–15:30)", () => {
    const layout = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 14 * 60,
      endMinutes: 15 * 60 + 30,
    });
    expect(layout.visible).toBe(true);
    expect(layout.clippedStart).toBe(false);
    expect(layout.clippedEnd).toBe(false);
    // 14:00 − 09:00 = 5h = 10 slots * 28 = 280
    expect(layout.topPx).toBe(280);
    // 90 min = 3 slots * 28 = 84
    expect(layout.heightPx).toBe(84);
  });

  it("does not clamp a 07:00 start to look like 09:00", () => {
    const early = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 7 * 60,
      endMinutes: 8 * 60,
    });
    expect(early.visible).toBe(false);

    const spanning = layoutBlockInVisibleRange({
      ...BASE,
      startMinutes: 7 * 60,
      endMinutes: 10 * 60,
    });
    expect(spanning.visible).toBe(true);
    expect(spanning.topPx).toBe(0);
    expect(spanning.clippedStart).toBe(true);
    // Only 09:00–10:00 visible — not a fake full 07:00 block at top
    expect(spanning.heightPx).toBe(56);
  });
});
