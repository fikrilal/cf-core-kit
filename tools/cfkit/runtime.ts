import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PORT = 8795;
const STARTUP_TIMEOUT_MS = 60_000;

type RuntimeCheck = Readonly<{
  name: string;
  run: (base: string) => Promise<string | undefined>;
}>;

function signingKeys(): string {
  const result = spawnSync("node", ["scripts/auth/generate-keys.mjs"], {
    encoding: "utf8",
  });
  const line = result.stdout
    .split("\n")
    .find((entry) => entry.startsWith("AUTH_SIGNING_KEYS_JSON="));

  if (result.status !== 0 || line === undefined) {
    throw new Error("could not generate local signing keys");
  }

  return line.slice("AUTH_SIGNING_KEYS_JSON=".length);
}

function startServer(
  port: number,
  persist: string,
  keys: string,
  logs: string[],
): ChildProcess {
  const server = spawn(
    "npx",
    [
      "--no-install",
      "wrangler",
      "dev",
      "--port",
      String(port),
      "--persist-to",
      persist,
      "--var",
      `AUTH_SIGNING_KEYS_JSON:${keys}`,
      "--var",
      "AUTH_OIDC_GOOGLE_CLIENT_IDS:runtime-smoke.apps.googleusercontent.com",
    ],
    { stdio: ["ignore", "pipe", "pipe"], detached: true },
  );

  server.stdout.on("data", (chunk: Buffer) => logs.push(String(chunk)));
  server.stderr.on("data", (chunk: Buffer) => logs.push(String(chunk)));

  return server;
}

function stopServer(server: ChildProcess): void {
  if (server.pid === undefined) return;

  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {
    server.kill("SIGTERM");
  }
}

async function probe(url: string): Promise<Response | undefined> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(2_000) });
  } catch {
    return undefined;
  }
}

async function waitForHealth(base: string): Promise<boolean> {
  const deadline = Date.now() + STARTUP_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const response = await probe(`${base}/health`);

    if (response?.status === 200) return true;

    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  return false;
}

async function expectJson(
  url: string,
  status: number,
  expectation: (body: Record<string, unknown>) => string | undefined,
): Promise<string | undefined> {
  const response = await probe(url);

  if (response === undefined) return "no response";
  if (response.status !== status) return `status ${String(response.status)}`;

  const body: unknown = await response.json();

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return "non-object body";
  }

  const record: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) record[key] = value;

  return expectation(record);
}

const CHECKS: readonly RuntimeCheck[] = [
  {
    name: "GET /health answers ok",
    run: (base) =>
      expectJson(`${base}/health`, 200, (body) =>
        body.status === "ok"
          ? undefined
          : `status field ${String(body.status)}`,
      ),
  },
  {
    name: "GET /ready answers ok",
    run: (base) =>
      expectJson(`${base}/ready`, 200, (body) =>
        body.status === "ok"
          ? undefined
          : `status field ${String(body.status)}`,
      ),
  },
  {
    name: "GET /.well-known/jwks.json publishes public keys only",
    run: async (base) => {
      const response = await probe(`${base}/.well-known/jwks.json`);

      if (response === undefined) return "no response";
      if (response.status !== 200) return `status ${String(response.status)}`;

      const text = await response.text();

      if (text.includes('"d"')) return "private key material present";
      if (!text.includes('"keys"')) return "no keys array";
      if (!text.includes('"EdDSA"')) return "no EdDSA key";

      return undefined;
    },
  },
];

async function runChecks(base: string): Promise<readonly string[]> {
  const failures: string[] = [];

  for (const check of CHECKS) {
    const failure = await check.run(base);

    console.log(`  ${failure === undefined ? "\u2713" : "x"} ${check.name}`);

    if (failure !== undefined) failures.push(`${check.name}: ${failure}`);
  }

  return failures;
}

function diagnostics(logs: readonly string[]): string {
  return logs.join("").split("\n").slice(-25).join("\n");
}

export async function runRuntimeSmoke(): Promise<number> {
  const port = Number(process.env.CFKIT_RUNTIME_PORT ?? DEFAULT_PORT);
  const base = `http://127.0.0.1:${String(port)}`;
  const persist = mkdtempSync(join(tmpdir(), "cfkit-runtime-"));
  const logs: string[] = [];
  const server = startServer(port, persist, signingKeys(), logs);

  try {
    if (!(await waitForHealth(base))) {
      console.error("[runtime] the dev server never became healthy");
      console.error(diagnostics(logs));

      return 1;
    }

    const failures = await runChecks(base);

    if (failures.length > 0) {
      for (const failure of failures) console.error(`[runtime] ${failure}`);
      console.error(diagnostics(logs));

      return 1;
    }

    console.log("[runtime] local boot smoke passed");

    return 0;
  } finally {
    stopServer(server);
    rmSync(persist, { recursive: true, force: true });
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  process.exitCode = await runRuntimeSmoke();
}
