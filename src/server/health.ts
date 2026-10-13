import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { logger } from "@/server/observability/logger"

export type ReadinessReport = {
  status: "ok" | "unavailable"
  checks: { database: "ok" | "error" }
}

/** Dependencies a replica needs before Caddy routes traffic to it. */
export async function checkReadiness(): Promise<ReadinessReport> {
  try {
    await getDb().execute(sql`select 1`)
    return { status: "ok", checks: { database: "ok" } }
  } catch (err) {
    logger.warn({ err }, "readiness check failed: database")
    return { status: "unavailable", checks: { database: "error" } }
  }
}
