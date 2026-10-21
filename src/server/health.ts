import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { logger } from "@/server/observability/logger"

export type ReadinessReport = {
  status: "ok" | "unavailable"
  /** The git SHA this replica runs, so deploys can confirm the switch. */
  version: string
  checks: { database: "ok" | "error" }
}

const VERSION = process.env.APP_SHA ?? "dev"

/** Dependencies a replica needs before it takes traffic (ops/deploy.sh). */
export async function checkReadiness(): Promise<ReadinessReport> {
  try {
    await getDb().execute(sql`select 1`)
    return { status: "ok", version: VERSION, checks: { database: "ok" } }
  } catch (err) {
    logger.warn({ err }, "readiness check failed: database")
    return {
      status: "unavailable",
      version: VERSION,
      checks: { database: "error" },
    }
  }
}
