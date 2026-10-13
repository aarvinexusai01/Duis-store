import { loadEnvConfig } from "@next/env"
import { defineConfig } from "drizzle-kit"

// drizzle-kit runs outside Next.js; load .env the same way Next does.
loadEnvConfig(process.cwd(), true)

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/db/schema/index.ts",
  out: "./src/db/migrations",
  casing: "snake_case",
  // pg-boss owns the `pgboss` schema; drizzle-kit must never touch it.
  schemaFilter: ["public"],
  migrations: { schema: "drizzle", table: "__drizzle_migrations" },
  dbCredentials: {
    // Owner role: migrations are the only place DDL runs. `generate` works
    // without it; `migrate` and `studio` fail clearly if it is missing.
    url: process.env.MIGRATION_DATABASE_URL ?? "",
  },
  strict: true,
  verbose: true,
})
