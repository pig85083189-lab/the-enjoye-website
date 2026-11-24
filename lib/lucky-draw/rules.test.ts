import { describe, expect, it } from "vitest";
import { DEFAULT_LUCKY_DRAW_RULES as rules, spendDraws, pointsRequired, treatmentDraws, birthdayDraws } from "./rules";
describe("lucky draw eligibility", () => {
  it("awards only whole spending thresholds", () => {
    expect(spendDraws(999, rules)).toBe(0);
    expect(spendDraws(1000, rules)).toBe(1);
    expect(spendDraws(3999, rules)).toBe(3);
  });
  it("uses confirmed defaults", () => {
    expect(pointsRequired(2, rules)).toBe(200);
    expect(treatmentDraws(rules)).toBe(1);
    expect(birthdayDraws(rules)).toBe(3);
    expect(rules.manual.enabled).toBe(true);
  });
  it("rejects invalid amounts", () => {
    expect(() => spendDraws(-1, rules)).toThrow();
    expect(() => pointsRequired(0, rules)).toThrow();
    expect(() => pointsRequired(1.5, rules)).toThrow();
  });
  it("honors disabled rules", () => {
    expect(spendDraws(3000, {...rules, spend:{...rules.spend, enabled:false}})).toBe(0);
    expect(() => pointsRequired(1, {...rules, points:{...rules.points, enabled:false}})).toThrow();
  });
});
