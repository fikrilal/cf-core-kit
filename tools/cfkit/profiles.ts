export type VerifyProfileName = "fast" | "full" | "runtime" | "smoke" | "ci";

export type VerifyStep = Readonly<{
  id: string;
  script: string;
}>;

export type VerifyProfile = Readonly<{
  name: VerifyProfileName;
  steps: readonly VerifyStep[];
  composes: readonly VerifyProfileName[];
}>;

const SCRIPT_IDS: readonly string[] = [
  "format:check",
  "lint",
  "typecheck",
  "typecheck:cfkit",
  "test",
  "test:scripts",
  "budget:check",
  "secrets:check",
  "drift:check",
  "contract:check",
  "contract:lint",
  "config:check",
  "harness:parity",
];

function scriptStep(id: string): VerifyStep {
  return { id, script: id };
}

const FAST_STEPS: readonly VerifyStep[] = SCRIPT_IDS.map(scriptStep);
const FULL_STEPS: readonly VerifyStep[] = [
  ...FAST_STEPS,
  scriptStep("test:coverage"),
  scriptStep("duplication:check"),
  scriptStep("build"),
  scriptStep("smells:check"),
  scriptStep("audit:prod"),
];
const RUNTIME_STEPS: readonly VerifyStep[] = [
  { id: "runtime.smoke", script: "runtime:check" },
];
const SMOKE_STEPS: readonly VerifyStep[] = [
  { id: "scaffold.smoke", script: "scaffold:smoke" },
];

export const VERIFY_PROFILES: Readonly<
  Record<VerifyProfileName, VerifyProfile>
> = {
  fast: { name: "fast", steps: FAST_STEPS, composes: [] },
  full: { name: "full", steps: FULL_STEPS, composes: [] },
  runtime: { name: "runtime", steps: RUNTIME_STEPS, composes: [] },
  smoke: { name: "smoke", steps: SMOKE_STEPS, composes: [] },
  ci: { name: "ci", steps: [], composes: ["full", "runtime", "smoke"] },
};

export function resolveProfile(name: string): VerifyProfile | undefined {
  if (
    name === "fast" ||
    name === "full" ||
    name === "runtime" ||
    name === "smoke" ||
    name === "ci"
  ) {
    return VERIFY_PROFILES[name];
  }

  return undefined;
}

export function expandProfile(
  name: VerifyProfileName,
  registry: Readonly<
    Record<VerifyProfileName, VerifyProfile>
  > = VERIFY_PROFILES,
): readonly VerifyStep[] {
  const steps: VerifyStep[] = [];
  const path: VerifyProfileName[] = [];

  const walk = (current: VerifyProfileName): void => {
    if (path.includes(current)) {
      throw new Error(
        `Verify profile cycle: ${[...path, current].join(" -> ")}`,
      );
    }

    path.push(current);

    const profile = registry[current];

    steps.push(...profile.steps);

    for (const composed of profile.composes) walk(composed);

    path.pop();
  };

  walk(name);

  return steps;
}
