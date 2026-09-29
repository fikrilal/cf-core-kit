import { UsageError } from "./usage-error.ts";

export function flagValue(
  args: readonly string[],
  flag: string,
): string | undefined {
  const index = args.indexOf(flag);

  return index === -1 ? undefined : args[index + 1];
}

export type FlagSpec = Readonly<Record<string, "value" | "boolean">>;

function assertFlagToken(
  args: readonly string[],
  index: number,
  spec: FlagSpec,
): number {
  const token = args[index] ?? "";
  const kind = spec[token];

  if (kind === undefined) {
    const known = Object.keys(spec).sort();

    throw new UsageError(
      known.length === 0
        ? `unknown flag "${token}" (no flags are accepted here)`
        : `unknown flag "${token}" (expected ${known.join("|")})`,
    );
  }

  if (kind === "value") {
    const next = args[index + 1];

    if (next === undefined || next.startsWith("--")) {
      throw new UsageError(`flag "${token}" needs a value`);
    }

    return index + 1;
  }

  return index;
}

export function assertFlags(
  args: readonly string[],
  spec: FlagSpec,
  options: Readonly<{ maxPositionals?: number }> = {},
): void {
  let positionals = 0;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index] ?? "";

    if (!token.startsWith("--")) {
      positionals += 1;
      continue;
    }

    index = assertFlagToken(args, index, spec);
  }

  const max = options.maxPositionals;

  if (max !== undefined && positionals > max) {
    throw new UsageError(
      `unexpected argument (expected at most ${String(max)} positional argument${max === 1 ? "" : "s"})`,
    );
  }
}

export function requireFlagValue(
  args: readonly string[],
  flag: string,
): string {
  const value = flagValue(args, flag);

  if (value === undefined) {
    throw new UsageError(`missing required flag "${flag}"`);
  }

  return value;
}
