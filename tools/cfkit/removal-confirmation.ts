/**
 * The confirmation semantics for removal, in one place so both the CLI and its fixtures read the same rule.
 * Removing an endpoint is reversible by re-scaffolding; removing a feature deletes files, so it needs an
 * explicit `--yes`, and the two protected core features need `--force-core` on top of that.
 */
export const PROTECTED_FEATURES: readonly string[] = ["auth", "users"];

export type ConfirmationVerdict =
  Readonly<{ ok: true }> | Readonly<{ ok: false; message: string }>;

export function isProtectedFeature(name: string): boolean {
  return PROTECTED_FEATURES.includes(name);
}

export function confirmRemoval(
  input: Readonly<{
    kind: "endpoint" | "feature";
    target: string;
    flags: ReadonlySet<string>;
  }>,
): ConfirmationVerdict {
  if (input.kind === "feature" && !input.flags.has("--yes")) {
    return {
      ok: false,
      message:
        "[cfkit] refusing to remove a feature without --yes (nothing was changed)",
    };
  }

  if (
    input.kind === "feature" &&
    isProtectedFeature(input.target) &&
    !input.flags.has("--force-core")
  ) {
    return {
      ok: false,
      message: `[cfkit] refusing to remove protected core feature "${input.target}"; pass --force-core to override`,
    };
  }

  return { ok: true };
}
