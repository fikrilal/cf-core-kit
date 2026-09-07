export type VerifyProfileName = "fast" | "full";

export type VerifyProfile = Readonly<{
  name: VerifyProfileName;
  steps: readonly string[];
}>;

const FAST_STEPS: readonly string[] = [
  "format:check",
  "lint",
  "typecheck",
  "typecheck:cfkit",
  "test",
  "test:scripts",
  "budget:check",
  "drift:check",
];

export const VERIFY_PROFILES: Readonly<
  Record<VerifyProfileName, VerifyProfile>
> = {
  fast: { name: "fast", steps: FAST_STEPS },
  full: { name: "full", steps: [...FAST_STEPS, "build"] },
};

export function resolveProfile(name: string): VerifyProfile | undefined {
  if (name === "fast" || name === "full") return VERIFY_PROFILES[name];

  return undefined;
}
