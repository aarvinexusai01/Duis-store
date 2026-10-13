import { existsSync, readdirSync } from "node:fs"
import { defineConfig, globalIgnores } from "eslint/config"
import nextVitals from "eslint-config-next/core-web-vitals"
import nextTs from "eslint-config-next/typescript"
import prettier from "eslint-config-prettier/flat"

// Import boundaries from doc/04-folder-structure.md §7, enforced with the
// built-in no-restricted-imports rule (no extra plugin).

const FEATURES_DIR = "src/features"
const features = existsSync(FEATURES_DIR)
  ? readdirSync(FEATURES_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  : []

const deepRelativeImports = {
  group: ["../../*"],
  message: "Use the `@/` alias instead of reaching up two or more folders.",
}

// Each feature may import its own files freely, but other features only
// through their public index (`@/features/<name>`).
const featureBoundaries = features.map((name) => ({
  files: [`${FEATURES_DIR}/${name}/**/*.{ts,tsx}`],
  rules: {
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["@/features/*/*", `!@/features/${name}/**`],
            message:
              "Import other features only through their public index (`@/features/<name>`).",
          },
          deepRelativeImports,
        ],
      },
    ],
  },
}))

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    files: ["src/app/**/*.{ts,tsx}", "src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/features/*/repository",
                "@/features/*/repository/*",
                "@/features/*/service",
                "@/server/db",
                "@/server/db/*",
                "@/db/*",
              ],
              message:
                "UI and routes go through feature actions, queries or the public index — never repositories, services or the database client.",
            },
          ],
        },
      ],
    },
  },
  ...featureBoundaries,
  {
    files: ["src/lib/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "@/app/*",
                "@/db/*",
                "@/features/*",
                "@/server/*",
                "next",
                "next/*",
              ],
              message:
                "lib/ stays free of framework, database and domain imports.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: ["src/db/migrations/**"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "MemberExpression[object.name='sql'][property.name='raw']",
          message:
            "sql.raw bypasses parameterisation; use the sql`` template instead.",
        },
      ],
    },
  },
  // Must stay last: turns off stylistic rules that Prettier owns.
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "dist/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
  ]),
])
