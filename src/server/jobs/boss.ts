import "server-only"
import { PgBoss } from "pg-boss"

import { getServerEnv } from "@/config/env"
import { logger } from "@/server/observability/logger"

export const JOBS_SCHEMA = "pgboss"

type BossRole = "web" | "worker"

/**
 * pg-boss keeps its queue in the `pgboss` schema, owned by the runtime role
 * (see doc/adr/0015-job-queue-and-database-roles.md).
 *
 * - worker: installs/upgrades the schema, runs schedules and maintenance.
 * - web: only sends jobs; it never migrates or supervises.
 *
 * To enqueue inside a business transaction, pass
 * `{ db: fromDrizzle(tx, sql) }` to `send()` so the job only exists if the
 * transaction commits.
 */
export function createBoss(role: BossRole): PgBoss {
  const env = getServerEnv()
  const isWorker = role === "worker"

  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: JOBS_SCHEMA,
    application_name: `duis-${role}-jobs`,
    max: isWorker ? 5 : 2,
    // The schema is created by docker/postgres/initdb; pg-boss manages
    // everything inside it.
    createSchema: false,
    migrate: isWorker,
    supervise: isWorker,
    schedule: isWorker,
  })

  boss.on("error", (err) => {
    logger.error({ err, role }, "job queue error")
  })

  return boss
}
