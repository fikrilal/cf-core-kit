import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { vi } from "vitest";

import {
  authEnv,
  permissiveLimiterFactory,
  TEST_TOKEN_INSTANT,
  userAccessToken,
} from "./auth-fixtures";
import { send } from "./app-request";
import { fixedClock } from "../src/platform/clock/clock";
import { createDb } from "../src/platform/db/db";
import { storedFiles, users } from "../src/platform/db/schema";
import { createApp } from "../src/platform/http/app";
import { registerUsersRoutes } from "../src/features/users/users.routes";

export const CLOCK = fixedClock(TEST_TOKEN_INSTANT);
export const SEED_NOW = new Date(TEST_TOKEN_INSTANT.getTime() - 60_000);

export const R2_ENV = {
  ...authEnv(),
  R2_ACCESS_KEY_ID: "CFEXAMPLEKEY12345",
  R2_SECRET_ACCESS_KEY: "c2VjcmV0LXRlc3Qta2V5",
};

export type CapturedRequest = Readonly<{ method: string; url: string }>;

export function stubSignedFetch(
  respond: (input: CapturedRequest) => Response,
): CapturedRequest[] {
  const calls: CapturedRequest[] = [];

  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const method =
      input instanceof Request ? input.method : (init?.method ?? "GET");
    const captured = { method, url };
    calls.push(captured);

    return Promise.resolve(respond(captured));
  });

  return calls;
}

export function headOk(sizeBytes: number, contentType: string): Response {
  return new Response(null, {
    status: 200,
    headers: {
      "content-length": String(sizeBytes),
      "content-type": contentType,
    },
  });
}

export function db() {
  return createDb(env.DB);
}

export function buildImageApp(queue?: Queue) {
  const app = createApp();

  registerUsersRoutes(app, {
    clock: CLOCK,
    queue,
    rateLimiterFactory: permissiveLimiterFactory(),
  });

  return app;
}

export async function seedImageUser(): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(users)
    .values({
      id,
      email: `image-${id}@example.com`,
      emailVerifiedAt: SEED_NOW,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

  return id;
}

export type SeedFileOptions = Readonly<{
  status?: "UPLOADING" | "ACTIVE" | "DELETED";
  contentType?: string;
  sizeBytes?: number;
  uploadedAt?: Date | null;
}>;

export async function seedFile(
  ownerUserId: string,
  options: SeedFileOptions = {},
): Promise<string> {
  const id = crypto.randomUUID();

  await db()
    .insert(storedFiles)
    .values({
      id,
      ownerUserId,
      purpose: "PROFILE_IMAGE",
      status: options.status ?? "UPLOADING",
      bucket: "cf-core-kit-dev",
      objectKey: `users/${ownerUserId}/profile-images/${id}`,
      contentType: options.contentType ?? "image/webp",
      sizeBytes: options.sizeBytes ?? 4,
      uploadedAt: options.uploadedAt ?? null,
      deletedAt: null,
      createdAt: SEED_NOW,
      updatedAt: SEED_NOW,
    });

  return id;
}

export async function pointUserAt(userId: string, fileId: string | null) {
  await db()
    .update(users)
    .set({ profileImageFileId: fileId, updatedAt: SEED_NOW })
    .where(eq(users.id, userId));
}

export async function fileRow(fileId: string) {
  const rows = await db()
    .select()
    .from(storedFiles)
    .where(eq(storedFiles.id, fileId));
  const [row] = rows;
  if (row === undefined) throw new Error("expected a stored file row");

  return row;
}

export async function imageRequest(
  path: string,
  method: "POST" | "DELETE" | "GET",
  userId: string,
  options: Readonly<{
    body?: Record<string, unknown>;
    env?: Env;
    queue?: Queue;
  }> = {},
): Promise<Response> {
  const accessToken = await userAccessToken(userId, {
    now: TEST_TOKEN_INSTANT,
  });

  return send(
    buildImageApp(options.queue),
    `https://example.com${path}`,
    {
      method,
      headers: {
        authorization: `Bearer ${accessToken}`,
        ...(options.body === undefined
          ? {}
          : { "content-type": "application/json" }),
      },
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
    },
    options.env ?? R2_ENV,
  );
}
