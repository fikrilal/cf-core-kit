import type { VerifyProfileName } from "./profiles.ts";

export type ProfileDurationBudget = Readonly<{
  observedMs: number;
  advisoryMs: number;
}>;

/**
 * Calibrated 2026-10-12 from clean runs on this repository (fast 98.2s, ci 207.1s,
 * runtime.smoke 2.5s, scaffold.smoke 53.1s; full derived as ci minus the composed
 * profiles = 151.5s; the gates profile measured 6.1s when it landed in plan A6).
 * Advisories are roughly twice the observed baseline, except the second-scale runtime
 * smoke and gates profiles, which get a 30s floor so shared runners do not trip them.
 * Advisory only, never failing; re-calibrate from reviewed clean runs.
 */
export const PROFILE_DURATION_BUDGETS: Readonly<
  Record<VerifyProfileName, ProfileDurationBudget>
> = {
  fast: { observedMs: 98_000, advisoryMs: 200_000 },
  full: { observedMs: 150_000, advisoryMs: 300_000 },
  gates: { observedMs: 6_000, advisoryMs: 30_000 },
  runtime: { observedMs: 3_000, advisoryMs: 30_000 },
  smoke: { observedMs: 53_000, advisoryMs: 120_000 },
  ci: { observedMs: 207_000, advisoryMs: 420_000 },
};

export function durationAdvisory(
  profile: VerifyProfileName,
  durationMs: number,
): string | undefined {
  const budget = PROFILE_DURATION_BUDGETS[profile];

  if (durationMs <= budget.advisoryMs) return undefined;

  return `Duration advisory: ${profile} took ${String(durationMs)}ms; calibration budget is ${String(budget.advisoryMs)}ms (observed baseline ${String(budget.observedMs)}ms).`;
}
