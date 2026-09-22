# Configuration

Configuration is zod-validated (`src/platform/config/config.ts`), read once per env object, and
exposed as a frozen typed object. Features never read raw env — `context.env` is confined to
`src/platform/**` and the composition roots (budget-enforced); features receive typed helpers
(`configFrom`, `databaseFrom`, `presignerFrom`).

| Key                                        | Kind       | Default      | Notes                                                            |
| ------------------------------------------ | ---------- | ------------ | ---------------------------------------------------------------- |
| `APP_ENV`                                  | var        | `dev`        | `dev` \| `staging` \| `prod`                                     |
| `LOG_LEVEL`                                | var        | `info`       | `debug` is rejected when `APP_ENV=prod`                          |
| `AUTH_ACCESS_TOKEN_TTL_SECONDS`            | var        | 900          |                                                                  |
| `AUTH_REFRESH_TOKEN_TTL_SECONDS`           | var        | 2592000      |                                                                  |
| `AUTH_SIGNING_KEYS_JSON`                   | **secret** | —            | Ed25519 JWK array; `_BASE64` variant for shells that mangle JSON |
| `AUTH_OIDC_GOOGLE_CLIENT_IDS`              | var        | —            | comma-separated audiences                                        |
| `AUTH_ISSUER` / `AUTH_AUDIENCE`            | var        | —            | verified when set                                                |
| `R2_ACCOUNT_ID`, `R2_BUCKET`               | var        | placeholders | presign endpoint account/bucket                                  |
| `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | **secret** | —            | R2 API token for presigning                                      |

Rules:

- secrets never go in git: `.dev.vars` locally, `wrangler secret put <NAME> --env <env>` for
  deployed environments (`npm run deploy` targets dev);
- non-secret values live in `wrangler.jsonc` per environment (`env.dev`/`env.staging`/`env.prod`
  redeclare bindings and vars on purpose — see ADR-0010);
- sensitive keys are redacted centrally by the logger; a new secret must join
  `SENSITIVE_KEYS` in `src/platform/logging/redact.ts`;
- adding a key means: schema entry + `AppConfig` field + `ConfigKey` union + mapping, and a
  `config.spec.ts` case.
