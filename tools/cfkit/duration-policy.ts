import type { VerifyProfileName } from "./profiles.ts";

export type ProfileDurationBudget = Readonly<{
  observedMs: number;
  advisoryMs: number;
}>;

export const PROFILE_DURATION_BUDGETS: Readonly<
  Record<VerifyProfileName, ProfileDurationBudget>
> = {
  fast: { observedMs: 70_000, advisoryMs: 120_000 },
  full: { observedMs: 125_000, advisoryMs: 240_000 },
  runtime: { observedMs: 3_000, advisoryMs: 120_000 },
  smoke: { observedMs: 40_000, advisoryMs: 120_000 },
  ci: { observedMs: 170_000, advisoryMs: 360_000 },
};

export function durationAdvisory(
  profile: VerifyProfileName,
  durationMs: number,
): string | undefined {
  const budget = PROFILE_DURATION_BUDGETS[profile];

  if (durationMs <= budget.advisoryMs) return undefined;

  return `Duration advisory: ${profile} took ${String(durationMs)}ms; calibration budget is ${String(budget.advisoryMs)}ms (observed baseline ${String(budget.observedMs)}ms).`;
}
