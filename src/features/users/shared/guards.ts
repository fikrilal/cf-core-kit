import type { Context } from "hono";
import { eq } from "drizzle-orm";

import { AppError } from "../../../platform/errors/app-error";
import { databaseFrom } from "../../../platform/db/request";
import { users } from "../../../platform/db/schema";
import type { AppEnv } from "../../../platform/http/types";
import { ErrorCode } from "../../../shared/error-codes";

export async function requireLiveUser(
  context: Context<AppEnv>,
  userId: string,
): Promise<void> {
  const user = await databaseFrom(context)
    .select({ id: users.id, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .get();

  if (user === undefined || user.status === "DELETED") {
    throw new AppError({ status: 401, code: ErrorCode.UNAUTHORIZED });
  }
}
