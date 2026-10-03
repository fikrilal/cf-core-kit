export type FailureDescriptor = Readonly<{
  code: string;
  remediation: string;
  repairable: boolean;
}>;

export const UNKNOWN_STEP_DESCRIPTOR: FailureDescriptor = {
  code: "harness.unknown-step",
  remediation:
    "Escalate: this verification step has no registered taxonomy entry; add one in tools/cfkit/failure-taxonomy.ts.",
  repairable: false,
};

const DESCRIPTORS: Readonly<Record<string, FailureDescriptor>> = {
  "format:check": {
    code: "verify.format",
    remediation: "Run `npm run format` and commit the formatting.",
    repairable: true,
  },
  lint: {
    code: "verify.lint",
    remediation:
      "Fix the reported lint violations; record a reviewed exception instead of disabling a rule.",
    repairable: true,
  },
  typecheck: {
    code: "verify.types",
    remediation:
      "Fix the type errors; do not widen types or add assertions to silence them.",
    repairable: true,
  },
  "typecheck:cfkit": {
    code: "verify.types",
    remediation:
      "Fix the cfkit type errors (tools/cfkit/tsconfig.json); the harness must stay type-clean.",
    repairable: true,
  },
  test: {
    code: "verify.unit",
    remediation:
      "Fix the failing spec or the behaviour it pins; never relax the assertion to pass.",
    repairable: true,
  },
  "test:coverage": {
    code: "verify.unit",
    remediation:
      "Restore the missing coverage for the changed behaviour; do not lower the floors.",
    repairable: true,
  },
  "test:scripts": {
    code: "verify.scripts",
    remediation: "Fix the script fixtures or the script they pin.",
    repairable: true,
  },
  "budget:check": {
    code: "verify.budget",
    remediation:
      "Reduce the footprint (bundle, cron, KV writes, queue config, env access) rather than relaxing the rule.",
    repairable: true,
  },
  "secrets:check": {
    code: "verify.secrets",
    remediation:
      "Remove the secret from tracked files; use .dev.vars or `wrangler secret put`.",
    repairable: true,
  },
  "drift:check": {
    code: "verify.drift",
    remediation:
      "Regenerate the drifted artefact (db:generate, types, docs map/links) instead of editing it by hand.",
    repairable: true,
  },
  "contract:check": {
    code: "verify.contract",
    remediation:
      "Run `npm run contract:emit` and reconcile the parity manifest; never edit the pinned snapshot.",
    repairable: true,
  },
  "contract:lint": {
    code: "verify.contract",
    remediation: "Fix the OpenAPI rule violation reported by Spectral.",
    repairable: true,
  },
  "duplication:check": {
    code: "verify.duplication",
    remediation:
      "Extract the shared helper, or add a reviewed allowlist entry naming both files and a reason.",
    repairable: true,
  },
  build: {
    code: "verify.build",
    remediation:
      "Fix the build error (imports, bundle, wrangler configuration).",
    repairable: true,
  },
  "config:check": {
    code: "verify.environment",
    remediation:
      "Reconcile wrangler.jsonc vars, the documented secrets and src/platform/config/config.ts: the schema is the source of truth.",
    repairable: true,
  },
  "smells:check": {
    code: "verify.architecture",
    remediation:
      "Fix the reported smell or baseline it with SMELLS_BASELINE_APPROVED=true after review; report-only runs use smells:report.",
    repairable: true,
  },
  "audit:prod": {
    code: "verify.security",
    remediation:
      "Address the reported production dependency advisory (upgrade or replace the package); a registry that cannot be reached is not an advisory.",
    repairable: true,
  },
  "harness:parity": {
    code: "verify.parity",
    remediation:
      "Update the parity manifest row (or implement the missing device); never delete rows to pass.",
    repairable: true,
  },
  "runtime.smoke": {
    code: "runtime.verification",
    remediation:
      "Inspect the boot smoke log; the Worker must answer /health, /ready and JWKS locally.",
    repairable: true,
  },
  "scaffold.smoke": {
    code: "verify.scaffold",
    remediation:
      "Fix the scaffold/remove cycle so every touched file restores byte-for-byte.",
    repairable: true,
  },
};

export function failureDescriptor(stepId: string): FailureDescriptor {
  return DESCRIPTORS[stepId] ?? UNKNOWN_STEP_DESCRIPTOR;
}

export function knownStepIds(): readonly string[] {
  return Object.keys(DESCRIPTORS).sort();
}
