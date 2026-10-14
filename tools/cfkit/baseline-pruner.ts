import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Removal must not leave policy referencing files that no longer exist. A smell baseline key or an allowlist
 * pair that names a removed feature turns into a lie the next gate would happily accept, so removal prunes
 * them: the *files* are gone, and every reviewed entry that pointed at them goes with them.
 */
export const SMELLS_BASELINE_PATH = "tools/smells-baseline.json";
export const PRUNABLE_BASELINES: readonly string[] = [
  SMELLS_BASELINE_PATH,
  "tools/duplication-allowlist.json",
  "tools/small-helper-duplication-allowlist.json",
];

export type PruneOutcome = Readonly<{
  path: string;
  entriesBefore: number;
  entriesAfter: number;
  removed: readonly string[];
  written: boolean;
}>;

/** True when `path` is the removed file itself or lives inside a removed directory. */
export function isRemovedPath(
  path: string,
  files: readonly string[],
  directories: readonly string[],
): boolean {
  return (
    files.includes(path) ||
    directories.some(
      (directory) => path === directory || path.startsWith(`${directory}/`),
    )
  );
}

interface SmellKey {
  readonly key?: string;
  readonly ruleId?: string;
  readonly file?: string;
  readonly reviewedOn?: string;
}

interface AllowlistGroup {
  readonly reason?: string;
  readonly files?: readonly string[];
}

function pruneSmellBaseline(
  source: string,
  removedFiles: readonly string[],
  removedDirectories: readonly string[],
): Readonly<{ entries: readonly unknown[]; removed: readonly string[] }> {
  const parsed = JSON.parse(source) as { keys?: readonly SmellKey[] };
  const keys = parsed.keys ?? [];
  const kept: SmellKey[] = [];
  const removed: string[] = [];

  for (const entry of keys) {
    const file = entry.file ?? "";

    if (isRemovedPath(file, removedFiles, removedDirectories)) {
      removed.push(entry.key ?? file);
    } else {
      kept.push(entry);
    }
  }

  return {
    entries: kept,
    removed,
  };
}

function pruneAllowlist(
  source: string,
  removedFiles: readonly string[],
  removedDirectories: readonly string[],
): Readonly<{ entries: readonly unknown[]; removed: readonly string[] }> {
  const parsed = JSON.parse(source) as {
    reviewedAcceptable?: readonly AllowlistGroup[];
  };
  const groups = parsed.reviewedAcceptable ?? [];
  const kept: AllowlistGroup[] = [];
  const removed: string[] = [];

  for (const group of groups) {
    const files = group.files ?? [];

    if (
      files.some((file) =>
        isRemovedPath(file, removedFiles, removedDirectories),
      )
    ) {
      removed.push(files.join(" <-> "));
    } else {
      kept.push(group);
    }
  }

  return { entries: kept, removed };
}

export function pruneBaselines(
  root: string,
  input: Readonly<{
    files: readonly string[];
    directories: readonly string[];
    write: boolean;
  }>,
): readonly PruneOutcome[] {
  const outcomes: PruneOutcome[] = [];

  for (const relative of PRUNABLE_BASELINES) {
    const path = join(root, relative);

    if (!existsSync(path)) continue;

    const source = readFileSync(path, "utf8");
    const result =
      relative === SMELLS_BASELINE_PATH
        ? pruneSmellBaseline(source, input.files, input.directories)
        : pruneAllowlist(source, input.files, input.directories);

    if (result.removed.length === 0) continue;

    if (input.write) {
      const parsed = JSON.parse(source) as Record<string, unknown>;

      if (relative === SMELLS_BASELINE_PATH) {
        parsed.keys = result.entries;
      } else {
        parsed.reviewedAcceptable = result.entries;
      }

      writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`);
    }

    outcomes.push({
      path: relative,
      entriesBefore: result.entries.length + result.removed.length,
      entriesAfter: result.entries.length,
      removed: result.removed,
      written: input.write,
    });
  }

  return outcomes;
}
