import eslint from "@eslint/js";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";
import importX from "eslint-plugin-import-x";
import prettier from "eslint-config-prettier";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "dist/**",
      ".wrangler/**",
      "coverage/**",
      "node_modules/**",
      "worker-configuration.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
  {
    files: ["**/*.ts"],
    plugins: { "import-x": importX },
    settings: {
      "import-x/resolver-next": [createTypeScriptImportResolver()],
    },
    rules: {
      // Strict quality baseline (ADR-0011): family-proven thresholds.
      complexity: ["error", 12],
      eqeqeq: ["error", "always"],
      "max-lines": [
        "error",
        { max: 350, skipBlankLines: true, skipComments: true },
      ],
      "max-lines-per-function": [
        "error",
        { max: 80, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      "no-console": "error",
      "import-x/first": "error",
      "import-x/newline-after-import": "error",
      "import-x/no-cycle": "error",
      "import-x/no-duplicates": "error",
      "import-x/no-mutable-exports": "error",
      "import-x/no-restricted-paths": [
        "error",
        {
          basePath: "src",
          zones: [
            {
              target: "./platform",
              from: "./features",
              message: "platform must not import features (ADR-0008)",
            },
            {
              target: "./features",
              from: ["./app.ts", "./worker.ts"],
              message: "features must not import app entry modules (ADR-0008)",
            },
            {
              target: "./shared",
              from: ["./platform", "./features"],
              message: "src/shared stays framework-free (ADR-0008)",
            },
            {
              target: "./features/auth",
              from: "./features/users",
              except: ["./index.ts"],
              message:
                "cross-feature imports go through the feature's index.ts (ADR-0008)",
            },
            {
              target: "./features/users",
              from: "./features/auth",
              except: ["./index.ts"],
              message:
                "cross-feature imports go through the feature's index.ts (ADR-0008)",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/platform/logging/**", "tools/cfkit/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["tools/cfkit/**/*.test.ts"],
    rules: {
      "@typescript-eslint/no-floating-promises": [
        "error",
        {
          allowForKnownSafeCalls: [
            { from: "package", package: "node:test", name: "test" },
          ],
        },
      ],
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      globals: {
        Buffer: "readonly",
        URL: "readonly",
        console: "readonly",
        crypto: "readonly",
        process: "readonly",
        structuredClone: "readonly",
        TextEncoder: "readonly",
      },
    },
    extends: [tseslint.configs.disableTypeChecked],
  },
  prettier,
);
