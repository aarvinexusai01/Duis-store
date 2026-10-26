/**
 * Which operational checks exist, when each counts as failing, and whom to
 * tell (doc/07 §7). Pure functions, so the rules are unit-tested; the
 * database side is in ./ops-checks.ts.
 */

export type OpsRow = {
  key: string
  ok: boolean
  detail: string | null
  checkedAt: Date
  lastOkAt: Date | null
  alertedAt: Date | null
}

export type OpsCheck = {
  key: string
  label: string
  ok: boolean
  detail: string | null
  checkedAt: Date | null
  lastOkAt: Date | null
}

const HOUR = 3_600_000
const DAY = 24 * HOUR

type Rule = {
  label: string
  /** The newest last success that still counts as healthy. */
  maxAge?: number
  /** Written from outside the app: missing on a real server means broken. */
  external: boolean
}

export const OPS_RULES: Record<string, Rule> = {
  worker: { label: "Background worker", external: false },
  "jobs.failed": { label: "Failed background jobs", external: false },
  "jobs.stuck": { label: "Job queues", external: false },
  // Only reported when REDIS_URL is set (ADR-0033).
  "cache.redis": { label: "Shared cache (Redis)", external: false },
  // Only reported when ELASTICSEARCH_URL is set (ADR-0033).
  "search.elasticsearch": {
    label: "Product search (Elasticsearch)",
    external: false,
  },
  "backup.wal": {
    label: "Continuous database archiving (WAL)",
    external: false,
  },
  // Daily differential or weekly full; 26 hours allows a slow night.
  "backup.pgbackrest": {
    label: "Database backup",
    maxAge: 26 * HOUR,
    external: true,
  },
  "backup.restic": {
    label: "Nightly copy of the database and images",
    maxAge: 26 * HOUR,
    external: true,
  },
  "backup.drill": {
    label: "Monthly restore drill",
    maxAge: 35 * DAY,
    external: true,
  },
  "host.disk": { label: "Server disk space", external: true },
  "host.memory": { label: "Server memory", external: true },
  "host.containers": { label: "Containers", external: true },
  "host.certificate": { label: "Origin certificate", external: true },
}

/** Host checks run every 15 minutes; silence for an hour means they stopped. */
const HOST_REPORT_MAX_AGE = HOUR
/** Repeat an unresolved alert this often. */
export const REALERT_AFTER = 6 * HOUR

const labelFor = (key: string) => OPS_RULES[key]?.label ?? key

/**
 * Every check with its effective state. A row that is stale counts as
 * failing even if it last reported success. When `expectExternal` is set (a
 * real server), checks written by backups and the host script must exist.
 */
export function evaluateOps(
  rows: OpsRow[],
  now: Date,
  options: { expectExternal: boolean },
): OpsCheck[] {
  const byKey = new Map(rows.map((row) => [row.key, row]))
  const keys = [
    ...Object.keys(OPS_RULES),
    ...rows.map((r) => r.key).filter((k) => !(k in OPS_RULES)),
  ]
  const checks: OpsCheck[] = []
  for (const key of keys) {
    const rule = OPS_RULES[key]
    const row = byKey.get(key)
    if (!row) {
      if (rule?.external && options.expectExternal) {
        checks.push({
          key,
          label: labelFor(key),
          ok: false,
          detail: key.startsWith("host.")
            ? "The host check has never reported. Is its timer installed?"
            : "Has never succeeded.",
          checkedAt: null,
          lastOkAt: null,
        })
      }
      continue
    }
    let ok = row.ok
    let detail = row.detail
    if (ok && rule?.maxAge !== undefined) {
      const last = row.lastOkAt ?? row.checkedAt
      if (now.getTime() - last.getTime() > rule.maxAge) {
        ok = false
        detail = `No success since ${formatIst(last)}.`
      }
    }
    if (
      key.startsWith("host.") &&
      now.getTime() - row.checkedAt.getTime() > HOST_REPORT_MAX_AGE
    ) {
      ok = false
      detail = `The host check stopped reporting (last ${formatIst(row.checkedAt)}).`
    }
    checks.push({
      key,
      label: labelFor(key),
      ok,
      detail,
      checkedAt: row.checkedAt,
      lastOkAt: row.lastOkAt,
    })
  }
  return checks
}

export type AlertPlan = {
  /** Failing checks to email about now: new, or not mentioned for 6 hours. */
  alert: OpsCheck[]
  /** Checks that were alerted and have recovered. */
  resolved: OpsCheck[]
}

export function planAlerts(
  checks: OpsCheck[],
  alertedAt: Map<string, Date | null>,
  now: Date,
): AlertPlan {
  const alert: OpsCheck[] = []
  const resolved: OpsCheck[] = []
  for (const check of checks) {
    const last = alertedAt.get(check.key) ?? null
    if (!check.ok) {
      if (!last || now.getTime() - last.getTime() >= REALERT_AFTER)
        alert.push(check)
    } else if (last) {
      resolved.push(check)
    }
  }
  return { alert, resolved }
}

export function formatIst(date: Date): string {
  return date.toLocaleString("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  })
}
