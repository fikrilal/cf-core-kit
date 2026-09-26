import type { OperationMetadata } from "../../platform/http/openapi";
import { accountDeletionOperations } from "./account-deletion/account-deletion.routes";
import { meOperations } from "./me/me.routes";
import { profileImageOperations } from "./profile-image/profile-image.routes";

export const usersOperations: readonly OperationMetadata[] = [
  ...meOperations,
  ...profileImageOperations,
  ...accountDeletionOperations,
];
