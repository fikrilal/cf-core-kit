import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

/**
 * A minimal repository lock, enough for the two run-once commands that must not overlap (`events run --once`,
 * `maintenance run --once`). Plan D15 grows this into the workspace model; until then it is deliberately small:
 * one file under `.cfkit/`, exclusive creation, a recorded pid, and a stale reclaim that trusts *pid liveness*
 * over a wall-clock timeout — with the caveat that pids are per-host, which is why the lock is documented as a
 * local-run guard rather than a distributed one.
 */
export const LOCK_PATH = ".cfkit/lock.json";
export const LOCK_FILE_MODE = 0o600;
export const LOCK_DIRECTORY_MODE = 0o700;

export type LockRecord = Readonly<{
  pid: number;
  command: string;
  startedAt: string;
}>;

export type LockHandle = Readonly<{
  path: string;
  record: LockRecord;
}>;

export type LockResult =
  | Readonly<{ ok: true; handle: LockHandle }>
  | Readonly<{ ok: false; holder: LockRecord | undefined; reason: string }>;

export function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch {
    return false;
  }
}

/** A corrupt lock file counts as unheld: the caller reclaims it and the attempt is recorded in the reason. */
export function readLock(root: string): LockRecord | undefined {
  const path = join(root, LOCK_PATH);

  if (!existsSync(path)) return undefined;

  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockRecord;
  } catch {
    return undefined;
  }
}

function tryCreate(path: string, record: LockRecord): boolean {
  try {
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, {
      flag: "wx",
      mode: LOCK_FILE_MODE,
    });

    return true;
  } catch {
    return false;
  }
}

export function acquireLock(
  root: string,
  input: Readonly<{ command: string; now?: Date }>,
): LockResult {
  const path = join(root, LOCK_PATH);
  const record: LockRecord = {
    pid: process.pid,
    command: input.command,
    startedAt: (input.now ?? new Date()).toISOString(),
  };

  mkdirSync(join(root, ".cfkit"), {
    recursive: true,
    mode: LOCK_DIRECTORY_MODE,
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (tryCreate(path, record)) return { ok: true, handle: { path, record } };

    const existing = readLock(root);

    if (existing !== undefined && isProcessAlive(existing.pid)) {
      return {
        ok: false,
        holder: existing,
        reason: `held by pid ${String(existing.pid)} (${existing.command} since ${existing.startedAt})`,
      };
    }

    rmSync(path, { force: true });
  }

  return {
    ok: false,
    holder: undefined,
    reason: "could not reclaim the stale lock",
  };
}

export function releaseLock(root: string, handle: LockHandle): void {
  const current = readLock(root);

  // Never release someone else's lock: a reclaimed lock could already belong to another process.
  if (current?.pid !== handle.record.pid) return;

  rmSync(handle.path, { force: true });
}

/** Runs `body` under the lock, releasing it even when the body throws or returns a failure code. */
export function withLock(
  root: string,
  command: string,
  body: (handle: LockHandle) => number,
): number {
  const result = acquireLock(root, { command });

  if (!result.ok) {
    console.error(
      `[cfkit] another run holds the repository lock: ${result.reason}`,
    );

    return 1;
  }

  try {
    return body(result.handle);
  } finally {
    releaseLock(root, result.handle);
  }
}
