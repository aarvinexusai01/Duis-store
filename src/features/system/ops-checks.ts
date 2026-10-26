import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { getSearchClient } from "@/features/catalog"
import { getRedis } from "@/server/cache/redis"
import { getDb } from "@/server/db/client"
import { QUEUES } from "@/server/jobs/queues"
import { queueEmail } from "@/server/notifications/email"

import {
  evaluateOps,
  planAlerts,
  type OpsCheck,
  type OpsRow,
} from "./ops-rules"

/**
 * Operational checks (doc/07 §7). Backups and the host script write their
 * own rows in ops_checks; the checks below are read from the database each
 * time. The system.ops-check job emails ops when something fails, and
 * /api/health/ops lets the uptime monitor notice even if the worker is down.
 */

type LiveCheck = { key: string; ok: boolean; detail: string | null }

const WORKER_SILENT_MS = 5 * 60_000
const ARCHIVE_SILENT_MS = 60 * 60_000

async function liveChecks(now: Date): Promise<LiveCheck[]> {
  const db = getDb()
  const [heartbeat, failed, stuck, archiver] = await Promise.all([
    db.execute<{ at: Date | null }>(sql`
      select max(completed_on) as at from pgboss.job
      where name = ${QUEUES.systemHeartbeat} and state = 'completed'`),
    db.execute<{ count: number }>(sql`
      select count(*)::int as count from pgboss.job
      where state = 'failed' and name <> ${QUEUES.deadLetter} and name not like '\\_\\_%'`),
    db.execute<{ name: string; count: number }>(sql`
      select name, count(*)::int as count from pgboss.job
      where state = 'created' and start_after < now() - interval '15 minutes'
        and name not like '\\_\\_%'
      group by name order by count desc`),
    db.execute<{
      mode: string
      last_archived_time: Date | null
      last_failed_time: Date | null
    }>(sql`
      select current_setting('archive_mode') as mode, last_archived_time, last_failed_time
      from pg_stat_archiver`),
  ])

  const checks: LiveCheck[] = []
  const redis = await redisCheck()
  if (redis) checks.push(redis)
  const search = await searchCheck()
  if (search) checks.push(search)

  const beat = heartbeat.rows[0]?.at ? new Date(heartbeat.rows[0].at) : null
  const workerOk =
    beat !== null && now.getTime() - beat.getTime() < WORKER_SILENT_MS
  checks.push({
    key: "worker",
    ok: workerOk,
    detail: workerOk
      ? null
      : beat
        ? "No heartbeat for over 5 minutes."
        : "Has never run.",
  })

  const failedCount = failed.rows[0]?.count ?? 0
  checks.push({
    key: "jobs.failed",
    ok: failedCount === 0,
    detail:
      failedCount === 0
        ? null
        : `${failedCount} job${failedCount === 1 ? " has" : "s have"} used up their retries. Retry or discard them on the System page.`,
  })

  checks.push({
    key: "jobs.stuck",
    ok: stuck.rows.length === 0,
    detail:
      stuck.rows.length === 0
        ? null
        : `Waiting over 15 minutes: ${stuck.rows.map((r) => `${r.name} (${r.count})`).join(", ")}.`,
  })

  const archive = archiver.rows[0]
  if (archive && archive.mode !== "off") {
    const archived = archive.last_archived_time
      ? new Date(archive.last_archived_time)
      : null
    const failedAt = archive.last_failed_time
      ? new Date(archive.last_failed_time)
      : null
    let ok = true
    let detail: string | null = null
    if (failedAt && (!archived || failedAt > archived)) {
      ok = false
      detail = "The last attempt to archive a WAL file failed."
    } else if (
      archived &&
      now.getTime() - archived.getTime() > ARCHIVE_SILENT_MS
    ) {
      ok = false
      detail = "No WAL file archived for over an hour."
    }
    checks.push({ key: "backup.wal", ok, detail })
  }
  return checks
}

async function redisCheck(): Promise<LiveCheck | null> {
  const redis = getRedis()
  if (!redis) return null
  try {
    if (redis.isReady && (await redis.ping()) === "PONG") {
      return { key: "cache.redis", ok: true, detail: null }
    }
  } catch {
    // reported below
  }
  return {
    key: "cache.redis",
    ok: false,
    detail:
      "Unreachable. The shop keeps working by reading everything from Postgres, so pages are slower under load.",
  }
}

const SEARCH_QUEUE_STUCK = "10 minutes"

async function searchCheck(): Promise<LiveCheck | null> {
  const client = getSearchClient()
  if (!client) return null
  const key = "search.elasticsearch"
  try {
    const health = await client.cluster.health({ timeout: "2s" })
    if (health.status === "red") {
      return {
        key,
        ok: false,
        detail: "The index is unavailable (status red). Searches use Postgres.",
      }
    }
  } catch {
    return {
      key,
      ok: false,
      detail:
        "Unreachable. Searches fall back to Postgres, which is slower under load.",
    }
  }
  const waiting = await getDb().execute<{ count: number }>(sql`
    select count(*)::int as count from search_index_queue
    where queued_at < now() - ${SEARCH_QUEUE_STUCK}::interval`)
  const stuck = waiting.rows[0]?.count ?? 0
  return stuck > 0
    ? {
        key,
        ok: false,
        detail: `${stuck} product change${stuck === 1 ? " has" : "s have"} waited over ${SEARCH_QUEUE_STUCK} to reach search. Is the worker running?`,
      }
    : { key, ok: true, detail: null }
}

async function storedRows(): Promise<OpsRow[]> {
  const result = await getDb().execute<{
    key: string
    ok: boolean
    detail: string | null
    checked_at: Date
    last_ok_at: Date | null
    alerted_at: Date | null
  }>(
    sql`select key, ok, detail, checked_at, last_ok_at, alerted_at from ops_checks`,
  )
  return result.rows.map((r) => ({
    key: r.key,
    ok: r.ok,
    detail: r.detail,
    checkedAt: new Date(r.checked_at),
    lastOkAt: r.last_ok_at ? new Date(r.last_ok_at) : null,
    alertedAt: r.alerted_at ? new Date(r.alerted_at) : null,
  }))
}

function expectExternal(): boolean {
  const { APP_ENV } = getServerEnv()
  return APP_ENV === "production" || APP_ENV === "staging"
}

async function load(now: Date): Promise<{
  stored: OpsRow[]
  live: LiveCheck[]
  checks: OpsCheck[]
}> {
  const [stored, live] = await Promise.all([storedRows(), liveChecks(now)])
  const byKey = new Map(stored.map((row) => [row.key, row]))
  const merged = [
    ...stored.filter((row) => !live.some((l) => l.key === row.key)),
    ...live.map((l): OpsRow => ({
      ...l,
      checkedAt: now,
      lastOkAt: l.ok ? now : (byKey.get(l.key)?.lastOkAt ?? null),
      alertedAt: byKey.get(l.key)?.alertedAt ?? null,
    })),
  ]
  return {
    stored,
    live,
    checks: evaluateOps(merged, now, { expectExternal: expectExternal() }),
  }
}

/** Every check's current state, for the System page and /api/health/ops. */
export async function loadOpsChecks(now = new Date()): Promise<OpsCheck[]> {
  return (await load(now)).checks
}

/**
 * The system.ops-check job (every 15 minutes): records the live checks and
 * emails OPS_ALERT_EMAIL about new failures, failures still open after six
 * hours, and recoveries. Returns how many emails were queued.
 */
export async function runOpsChecks(now = new Date()): Promise<number> {
  const { stored, live, checks } = await load(now)
  const db = getDb()

  for (const check of live) {
    await db.execute(sql`
      insert into ops_checks (key, ok, detail, checked_at, last_ok_at)
      values (${check.key}, ${check.ok}, ${check.detail}, ${now}, ${check.ok ? now : null})
      on conflict (key) do update set ok = excluded.ok, detail = excluded.detail,
        checked_at = excluded.checked_at,
        last_ok_at = coalesce(excluded.last_ok_at, ops_checks.last_ok_at)`)
  }

  const plan = planAlerts(
    checks,
    new Map(stored.map((row) => [row.key, row.alertedAt])),
    now,
  )
  if (plan.alert.length === 0 && plan.resolved.length === 0) return 0

  const env = getServerEnv()
  const recipients = env.OPS_ALERT_EMAIL ?? []
  let sent = 0
  for (const to of recipients) {
    const id = await queueEmail({
      template: "ops-alert",
      to,
      reference: { type: "ops_alert", id: now.toISOString() },
      props: {
        environment: env.APP_ENV,
        url: new URL("/admin/system", env.APP_URL).toString(),
        problems: checks
          .filter((c) => !c.ok)
          .map((c) => ({ label: c.label, detail: c.detail ?? "" })),
        resolved: plan.resolved.map((c) => c.label),
      },
    })
    if (id) sent += 1
  }

  for (const check of plan.alert) {
    await db.execute(sql`
      insert into ops_checks (key, ok, detail, checked_at, alerted_at)
      values (${check.key}, false, ${check.detail}, ${now}, ${now})
      on conflict (key) do update set alerted_at = excluded.alerted_at`)
  }
  for (const check of plan.resolved) {
    await db.execute(
      sql`update ops_checks set alerted_at = null where key = ${check.key}`,
    )
  }
  return sent
}
