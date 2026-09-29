import { spawn } from "node:child_process";

export const DEFAULT_CAPTURE_BYTES = 64 * 1024;
export const PROCESS_TIMEOUT_MS = 15 * 60 * 1000;
export const TIMEOUT_EXIT_CODE = 124;
export const SIGNAL_EXIT_CODE = 137;

export type ProcessCapture = Readonly<{
  exitCode: number;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}>;

export type RunProcessInput = Readonly<{
  command: string;
  args?: readonly string[];
  cwd?: string;
  timeoutMs?: number;
  maxCaptureBytes?: number;
  passthrough?: boolean;
}>;

class TailBuffer {
  readonly #max: number;
  #chunks: Buffer[] = [];
  #length = 0;
  #total = 0;

  constructor(max: number) {
    this.#max = max;
  }

  push(chunk: Buffer): void {
    this.#total += chunk.length;
    this.#chunks.push(chunk);
    this.#length += chunk.length;

    while (this.#length > this.#max) {
      const head = this.#chunks[0];

      if (head === undefined) break;

      const excess = this.#length - this.#max;

      if (head.length <= excess) {
        this.#chunks.shift();
        this.#length -= head.length;
      } else {
        this.#chunks[0] = head.subarray(excess);
        this.#length -= excess;
      }
    }
  }

  get truncated(): boolean {
    return this.#total > this.#length;
  }

  text(): string {
    return Buffer.concat(this.#chunks).toString("utf8");
  }
}

export async function runProcess(
  input: RunProcessInput,
): Promise<ProcessCapture> {
  const maxCaptureBytes = input.maxCaptureBytes ?? DEFAULT_CAPTURE_BYTES;
  const passthrough = input.passthrough ?? true;
  const stdout = new TailBuffer(maxCaptureBytes);
  const stderr = new TailBuffer(maxCaptureBytes);
  const startedAt = Date.now();
  const child = spawn(input.command, [...(input.args ?? [])], {
    cwd: input.cwd,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const state = { timedOut: false };
  const timer =
    input.timeoutMs === undefined
      ? undefined
      : setTimeout(() => {
          state.timedOut = true;
          child.kill("SIGKILL");
        }, input.timeoutMs);

  child.stdout.on("data", (chunk: Buffer) => {
    stdout.push(chunk);
    if (passthrough) process.stdout.write(chunk);
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr.push(chunk);
    if (passthrough) process.stderr.write(chunk);
  });

  const outcome = await new Promise<
    Readonly<{ code: number | null; signal: NodeJS.Signals | null }>
  >((resolve, reject) => {
    child.on("error", (error: Error) => {
      reject(error);
    });
    child.on("close", (code, signal) => {
      resolve({ code, signal });
    });
  }).finally(() => {
    clearTimeout(timer);
  });

  const exitCode =
    outcome.code ?? (state.timedOut ? TIMEOUT_EXIT_CODE : SIGNAL_EXIT_CODE);

  return {
    exitCode,
    signal: outcome.signal,
    timedOut: state.timedOut,
    durationMs: Date.now() - startedAt,
    stdout: stdout.text(),
    stderr: stderr.text(),
    stdoutTruncated: stdout.truncated,
    stderrTruncated: stderr.truncated,
  };
}
