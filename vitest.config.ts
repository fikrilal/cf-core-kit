import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

const testMigrations = await readD1Migrations("./db/migrations");

export default defineConfig({
  test: {
    include: ["src/**/*.spec.ts", "test/**/*.spec.ts"],
    setupFiles: ["./test/apply-migrations.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: ["src/**/*.spec.ts"],
      reporter: ["text-summary", "lcov", "json-summary"],
      thresholds: {
        statements: 85,
        branches: 78,
        functions: 90,
        lines: 88,
      },
    },
  },
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: { TEST_MIGRATIONS: testMigrations },
        queueConsumers: ["cf-core-kit-jobs-dev"],
      },
    }),
  ],
});
