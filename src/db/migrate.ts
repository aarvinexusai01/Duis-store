import { existsSync } from "node:fs"
import path from "node:path"

import { drizzle } from "drizzle-orm/node-postgres"
import { migrate } from "drizzle-orm/node-postgres/migrator"
import { Pool } from "pg"
import { z } from "zod"

import { logger } from "@/server/observability/logger"

/**
 * Applies pending Drizzle migrations as the schema owner (duis_owner).
 * Bundled to dist/migrate.mjs and run by the `migrate` container before the
 * web replicas restart; locally `npm run db:migrate` (drizzle-kit) uses the
 * same folder and journal table.
 */
const env = z
  .object({
    MIGRATION_DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    MIGRATIONS_DIR: z.string().min(1).default("src/db/migrations"),
  })
  .parse(process.env)

async function main(): Promise<void> {
  const migrationsFolder = path.resolve(env.MIGRATIONS_DIR)

  if (!existsSync(path.join(migrationsFolder, "meta", "_journal.json"))) {
    logger.info({ migrationsFolder }, "no migrations to apply")
    return
  }

  const pool = new Pool({
    connectionString: env.MIGRATION_DATABASE_URL,
    max: 1,
    application_name: "duis-migrate",
  })
  try {
    await migrate(drizzle({ client: pool }), {
      migrationsFolder,
      migrationsSchema: "drizzle",
      migrationsTable: "__drizzle_migrations",
    })
    logger.info({ migrationsFolder }, "migrations applied")
  } finally {
    await pool.end()
  }
}

main().catch((err: unknown) => {
  logger.fatal({ err }, "migration failed")
  process.exit(1)
})
