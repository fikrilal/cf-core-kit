import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ScaffoldApplyOptions } from "./scaffold-apply.ts";
import {
  coverageWithOperationReturned,
  readCoverageManifest,
  serializeCoverageManifest,
} from "./scaffold.ts";
import type { RemovalEdit, RemovePlan } from "./remove.ts";

function removeStatement(source: string, specifier: string): string {
  const lines = source.split("\n");
  const fromIndex = lines.findIndex((line) =>
    line.includes(`from "${specifier}"`),
  );

  if (fromIndex === -1) {
    throw new Error(`Import for "${specifier}" not found`);
  }

  let start = fromIndex;

  while (start > 0 && !/^\s*import\b/.test(lines[start] ?? "")) start -= 1;

  if (!/^\s*import\b/.test(lines[start] ?? "")) {
    throw new Error(`Import statement start not found for "${specifier}"`);
  }

  lines.splice(start, fromIndex - start + 1);

  return lines.join("\n");
}

function removeLine(source: string, contains: string): string {
  const lines = source.split("\n");
  const matches = lines
    .map((line, index) => (line.includes(contains) ? index : -1))
    .filter((index) => index >= 0);

  if (matches.length !== 1) {
    throw new Error(
      `Expected exactly one line containing "${contains}" (found ${String(matches.length)})`,
    );
  }

  lines.splice(matches[0] ?? 0, 1);

  return lines.join("\n");
}

function blockBounds(
  lines: readonly string[],
  index: number,
  feature: string,
): { start: number; end: number } {
  let start = index;
  while (start > 0 && (lines[start] ?? "").trim() !== "{") start -= 1;

  let end = index;
  while (end < lines.length && (lines[end] ?? "").trim() !== "},") end += 1;

  if ((lines[start] ?? "").trim() !== "{" || end >= lines.length) {
    throw new Error(`Zone block boundaries not found for feature "${feature}"`);
  }

  return { start, end };
}

function removeZoneBlocks(source: string, feature: string): string {
  const lines = source.split("\n");
  const markers = [
    `target: "./features/${feature}",`,
    `from: "./features/${feature}",`,
  ];
  const ranges: { start: number; end: number }[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = (lines[index] ?? "").trim();

    if (!markers.includes(trimmed)) continue;

    ranges.push(blockBounds(lines, index, feature));
  }

  for (const range of ranges.sort((a, b) => b.start - a.start)) {
    lines.splice(range.start, range.end - range.start + 1);
  }

  return lines.join("\n");
}

function applyRemovalEdits(
  source: string,
  edits: readonly RemovalEdit[],
): string {
  let current = source;

  for (const edit of edits) {
    if (edit.kind === "statement")
      current = removeStatement(current, edit.specifier);
    else if (edit.kind === "line") current = removeLine(current, edit.contains);
    else current = removeZoneBlocks(current, edit.feature);
  }

  return current;
}

function collectEditedContents(
  root: string,
  edits: readonly RemovalEdit[],
): ReadonlyMap<string, string> {
  const grouped = new Map<string, RemovalEdit[]>();

  for (const edit of edits) {
    grouped.set(edit.path, [...(grouped.get(edit.path) ?? []), edit]);
  }

  const edited = new Map<string, string>();

  for (const [path, pathEdits] of grouped) {
    edited.set(
      path,
      applyRemovalEdits(readFileSync(join(root, path), "utf8"), pathEdits),
    );
  }

  return edited;
}

function collectCoverageContent(
  root: string,
  plan: RemovePlan,
): string | undefined {
  if (plan.returnOperations.length === 0) return undefined;

  let manifest = readCoverageManifest(
    readFileSync(join(root, plan.coveragePath), "utf8"),
  );

  for (const operation of plan.returnOperations) {
    manifest = coverageWithOperationReturned(manifest, operation);
  }

  return serializeCoverageManifest(manifest);
}

export function applyRemovePlan(
  root: string,
  plan: RemovePlan,
  options: ScaffoldApplyOptions = {},
): readonly string[] {
  const edited = collectEditedContents(root, plan.edits);
  const coverage = collectCoverageContent(root, plan);
  const touched: string[] = [];

  for (const [path, content] of edited) {
    writeFileSync(join(root, path), content);
    touched.push(path);
  }

  if (coverage !== undefined) {
    writeFileSync(join(root, plan.coveragePath), coverage);
    touched.push(plan.coveragePath);
  }

  for (const file of plan.deleteFiles) {
    if (existsSync(join(root, file))) rmSync(join(root, file));
  }

  for (const directory of plan.removeDirectories) {
    const path = join(root, directory);

    if (existsSync(path)) rmSync(path, { recursive: true });
  }

  options.format?.(touched);

  return touched;
}
