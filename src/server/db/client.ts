import "server-only"
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import { getServerEnv } from "@/config/env"
import * as schema from "@/db/schema"
import { logger } from "@/server/observability/logger"

export type Database = NodePgDatabase<typeof schema>

// Survive hot reloads in development: one pool per process, created on first
// use so that importing this module never needs a database (e.g. next build).
const globalForDb = globalThis as typeof globalThis & {
  __duisPool?: Pool
  __duisDb?: Database
}

export function getPool(): Pool {
  if (!globalForDb.__duisPool) {
    const env = getServerEnv()
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
      application_name: process.env.SERVICE_NAME ?? "duis-web",
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
    })
    pool.on("error", (err) => {
      logger.error({ err }, "idle database client error")
    })
    globalForDb.__duisPool = pool
  }
  return globalForDb.__duisPool
}

export function getDb(): Database {
  globalForDb.__duisDb ??= drizzle({
    client: getPool(),
    schema,
    casing: "snake_case",
  })
  return globalForDb.__duisDb
}

export async function closeDb(): Promise<void> {
  const pool = globalForDb.__duisPool
  globalForDb.__duisPool = undefined
  globalForDb.__duisDb = undefined
  await pool?.end()
}
