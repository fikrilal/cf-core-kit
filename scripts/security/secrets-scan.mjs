import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const RULES = [
  {
    id: "private-key",
    pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  },
  {
    id: "aws-access-key",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "jwk-private",
    pattern: /"kty"\s*:\s*"OKP"[\s\S]{0,200}?"d"\s*:\s*"[^"]+"/,
  },
  {
    id: "secret-assignment",
    pattern:
      /\b(AUTH_SIGNING_KEYS_JSON|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID)\s*[:=]\s*[A-Za-z0-9+/=_-]{16,}/,
  },
];

export const ALLOWLIST = [
  // AWS's documented SigV4 example credentials; public knowledge and load-bearing for the
  // presign vector test (src/platform/storage/presign.spec.ts).
  "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  "AKIAIOSFODNN7EXAMPLE",
];

export const ALLOWLIST_PATHS = [
  {
    path: "test/auth-fixtures.ts",
    reason:
      "test-only signing keys generated for the suite; no production material",
  },
];

const SCREAMING_SNAKE = /^[A-Z][A-Z0-9_]*$/;

const SKIP_EXTENSIONS = [
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".woff",
  ".woff2",
  ".pdf",
  ".zip",
];

function assignmentLooksLikeConstant(line) {
  const match =
    /\b(?:AUTH_SIGNING_KEYS_JSON|R2_SECRET_ACCESS_KEY|R2_ACCESS_KEY_ID)\s*[:=]\s*([A-Za-z0-9+/=_-]{16,})/.exec(
      line,
    );

  return match?.[1] !== undefined && SCREAMING_SNAKE.test(match[1]);
}

export function scanText(path, content) {
  const violations = [];

  for (const line of content.split("\n")) {
    if (ALLOWLIST.some((entry) => line.includes(entry))) continue;

    for (const rule of RULES) {
      if (!rule.pattern.test(line)) continue;
      if (
        rule.id === "secret-assignment" &&
        assignmentLooksLikeConstant(line)
      ) {
        break;
      }

      violations.push({ path, rule: rule.id });
      break;
    }
  }

  if (/^[\s\S]*"kty"\s*:\s*"OKP"/.test(content)) {
    const multiline = /"kty"\s*:\s*"OKP"[\s\S]{0,400}?"d"\s*:\s*"/.test(
      content,
    );
    const lineAlreadyFlagged = violations.some(
      (violation) => violation.rule === "jwk-private",
    );

    if (multiline && !lineAlreadyFlagged) {
      violations.push({ path, rule: "jwk-private" });
    }
  }

  return violations;
}

export function scanRepository(root) {
  const listed = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
  });
  const violations = [];

  for (const path of listed.split("\0")) {
    if (path === "") continue;
    if (SKIP_EXTENSIONS.some((extension) => path.endsWith(extension))) continue;
    if (ALLOWLIST_PATHS.some((entry) => entry.path === path)) continue;

    const content = readFileSync(`${root}/${path}`, "utf8");
    violations.push(...scanText(path, content));
  }

  return violations;
}

function main() {
  const violations = scanRepository(process.cwd());

  if (violations.length === 0) {
    console.log("[secrets] no findings in tracked files");

    return;
  }

  console.error("[secrets] findings:");
  for (const violation of violations) {
    console.error(`  x [${violation.rule}] ${violation.path}`);
  }

  process.exitCode = 1;
}

const isDirectRun =
  process.argv[1] !== undefined &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href;

if (isDirectRun) main();
