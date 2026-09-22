# Adding a feature

A feature is a vertical slice under `src/features/<name>/`. The scaffold creates a capability
slice (no routes — routes arrive with a contract operation) and wires the cross-feature lint
zones so the every-pair boundary meta-test keeps holding.

```bash
npm run cfkit -- scaffold feature billing
#   create src/features/billing/service.ts
#   create src/features/billing/service.spec.ts
#   create src/features/billing/index.ts
#   edit   eslint.config.mjs   (two cross-feature zone entries per existing feature)
```

Then:

1. Replace the `TODO` marker in `service.ts` with the real domain logic and rename the exported
   function; keep the spec green.
2. Export the feature's public surface from `index.ts` — other features may only import through
   that barrel (ADR-0008).
3. Run `npm run verify` (fast profile) as you go and `npm run verify:ci` before publishing.
4. Follow the layering conventions: `src/platform/**` never imports features; features never
   import `src/worker.ts` or `src/app.ts`; `src/shared/**` stays framework-free.

Refusals:

- non-kebab names ("Billing", "order_history" normalizes; "2fa" fails);
- an existing `src/features/<name>/` directory;
- removal of `auth` or `users` without `--force-core`, or removal without `--yes`, or removal of
  a directory containing files the tool cannot prove it scaffolded (pass `--force` to override).

Removal is the exact inverse:

```bash
npm run cfkit -- remove feature billing --yes
```

The scaffold → remove cycle restores every touched file byte-for-byte; the CI `smoke` step
asserts exactly that on every run.
