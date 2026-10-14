/**
 * Conventional Commits with the repository's own scope vocabulary. CI does not run this: the hook is local, so
 * a commit message is a convention here and a fact in the history, not a gate.
 */
export const SCOPES = [
  "platform",
  "auth",
  "users",
  "contract",
  "harness",
  "budget",
  "queue",
  "storage",
  "email",
  "push",
  "ci",
  "docs",
  "deps",
  "build",
  "test",
  "release",
];

export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [2, "always", SCOPES],
    "scope-empty": [2, "never"],
    "header-max-length": [2, "always", 100],
    "body-max-line-length": [1, "always", 120],
  },
};
