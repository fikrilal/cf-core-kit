import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  coverageWithOperationMoved,
  readCoverageManifest,
  serializeCoverageManifest,
  type ScaffoldEdit,
  type ScaffoldPlan,
} from "./scaffold.ts";

export type ScaffoldApplyOptions = Readonly<{
  format?: (paths: readonly string[]) => void;
}>;

function applyEditsToSource(source: string, edit: ScaffoldEdit): string {
  const lines = source.split("\n");
  const matches = lines
    .map((line, index) => (line.includes(edit.anchor) ? index : -1))
    .filter((index) => index >= 0);

  if (matches.length !== 1) {
    throw new Error(
      `${edit.path}: expected exactly one line containing "${edit.anchor}" (found ${String(matches.length)})`,
    );
  }

  const index = matches[0] ?? 0;
  const inserted = edit.placement === "line-before" ? index : index + 1;

  lines.splice(inserted, 0, ...edit.lines);

  return lines.join("\n");
}

function collectEditedContents(
  root: string,
  edits: readonly ScaffoldEdit[],
): ReadonlyMap<string, string> {
  const edited = new Map<string, string>();

  for (const edit of edits) {
    const current =
      edited.get(edit.path) ?? readFileSync(join(root, edit.path), "utf8");

    edited.set(edit.path, applyEditsToSource(current, edit));
  }

  return edited;
}

function collectCoverageContent(
  root: string,
  moveOperation: string | undefined,
): string | undefined {
  if (moveOperation === undefined) return undefined;

  const manifest = readCoverageManifest(
    readFileSync(join(root, "tools/parity/coverage.json"), "utf8"),
  );

  return serializeCoverageManifest(
    coverageWithOperationMoved(manifest, moveOperation),
  );
}

function assertTargetsFree(root: string, plan: ScaffoldPlan): void {
  for (const file of plan.files) {
    if (existsSync(join(root, file.path))) {
      throw new Error(`File already exists: ${file.path}`);
    }
  }
}

export function applyScaffoldPlan(
  root: string,
  plan: ScaffoldPlan,
  options: ScaffoldApplyOptions = {},
): readonly string[] {
  assertTargetsFree(root, plan);

  const edited = collectEditedContents(root, plan.edits);
  const coverage = collectCoverageContent(root, plan.moveOperation);
  const touched: string[] = [];

  for (const file of plan.files) {
    const target = join(root, file.path);

    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, file.content);
    touched.push(file.path);
  }

  for (const [path, content] of edited) {
    writeFileSync(join(root, path), content);
    touched.push(path);
  }

  if (coverage !== undefined) {
    writeFileSync(join(root, "tools/parity/coverage.json"), coverage);
    touched.push("tools/parity/coverage.json");
  }

  options.format?.(touched);

  return touched;
}
