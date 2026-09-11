import { build } from "esbuild";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_OUTPUT = "docs/openapi/openapi.yaml";
export const DOC_TITLE = "CF Core Kit API";

export async function renderEmittedYaml(root) {
  const tempDir = join(root, "node_modules", ".cache", "cfkit-contract");
  const bundlePath = join(tempDir, "emit.entry.mjs");

  mkdirSync(tempDir, { recursive: true });

  try {
    await build({
      entryPoints: [join(root, "tools", "contract", "emit.entry.ts")],
      outfile: bundlePath,
      bundle: true,
      format: "esm",
      platform: "node",
      target: "es2023",
      packages: "external",
      logLevel: "silent",
    });

    const module = await import(pathToFileURL(bundlePath).href);
    const packageJson = JSON.parse(
      readFileSync(join(root, "package.json"), "utf8"),
    );
    const version =
      typeof packageJson.version === "string" ? packageJson.version : "0.0.0";

    return module.renderOpenApiYaml({ title: DOC_TITLE, version });
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const root = process.cwd();
  const target = process.argv[2] ?? DEFAULT_OUTPUT;
  const yaml = await renderEmittedYaml(root);
  const targetPath = join(root, target);

  mkdirSync(dirname(targetPath), { recursive: true });
  writeFileSync(targetPath, yaml);
  console.log(
    `[contract] emitted ${target} (${String(Buffer.byteLength(yaml))} bytes)`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectRun) {
  await main();
}
