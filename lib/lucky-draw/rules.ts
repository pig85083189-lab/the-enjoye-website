export type LuckyDrawRules = {
  spend: { enabled: boolean; amountMinor: number };
  points: { enabled: boolean; pointsPerDraw: number };
  treatment: { enabled: boolean; drawsPerTreatment: number };
  birthday: { enabled: boolean; drawsPerYear: number };
  manual: { enabled: boolean };
};
export const DEFAULT_LUCKY_DRAW_RULES: LuckyDrawRules = {
  spend: { enabled: true, amountMinor: 1000 },
  points: { enabled: true, pointsPerDraw: 100 },
  treatment: { enabled: true, drawsPerTreatment: 1 },
  birthday: { enabled: true, drawsPerYear: 3 },
  manual: { enabled: true },
};
function nonnegative(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("Invalid reward amount");
  return value;
}
function positive(value: number): number {
  if (nonnegative(value) === 0) throw new Error("Invalid reward threshold");
  return value;
}
export function spendDraws(amountMinor: number, rules: LuckyDrawRules): number {
  return rules.spend.enabled ? Math.floor(nonnegative(amountMinor) / positive(rules.spend.amountMinor)) : 0;
}
export function pointsRequired(draws: number, rules: LuckyDrawRules): number {
  if (!rules.points.enabled) throw new Error("Points redemption disabled");
  return nonnegative(positive(draws) * positive(rules.points.pointsPerDraw));
}
export function treatmentDraws(rules: LuckyDrawRules): number {
  return rules.treatment.enabled ? positive(rules.treatment.drawsPerTreatment) : 0;
}
export function birthdayDraws(rules: LuckyDrawRules): number {
  return rules.birthday.enabled ? positive(rules.birthday.drawsPerYear) : 0;
}
// The database must enforce uniqueness of (organization, member, source, sourceKey).
// These pure calculations do not grant credits or mutate any existing balance.
