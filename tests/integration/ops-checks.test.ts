import { sql } from "drizzle-orm"
import { beforeAll, describe, expect, it } from "vitest"

import { loadOpsChecks, runOpsChecks } from "@/features/system"
import { getDb } from "@/server/db/client"

import { closeConnectionsAfterAll } from "../helpers/cleanup"

// Read lazily by getServerEnv(), so setting it before the first call is enough.
process.env.OPS_ALERT_EMAIL = "ops@duis.test"

closeConnectionsAfterAll()

type AlertProps = {
  problems: { label: string; detail: string }[]
  resolved: string[]
}

async function alertEmails(): Promise<AlertProps[]> {
  const jobs = await getDb().execute<{ props: AlertProps }>(sql`
    select data->'props' as props from pgboss.job
    where name = 'notify.email' and data->>'template' = 'ops-alert'
      and data->>'to' = 'ops@duis.test'
    order by created_on`)
  return jobs.rows.map((r) => r.props)
}

beforeAll(async () => {
  await getDb().execute(sql`delete from ops_checks`)
  await getDb().execute(sql`
    delete from pgboss.job where name = 'notify.email' and data->>'template' = 'ops-alert'`)
})

describe("server checks", () => {
  it("emails ops when a backup goes stale, once, then when it recovers", async () => {
    const t0 = new Date()
    await getDb().execute(sql`
      insert into ops_checks (key, ok, detail, checked_at, last_ok_at)
      values ('backup.pgbackrest', true, 'diff backup', ${t0},
              ${new Date(t0.getTime() - 30 * 3_600_000)})`)

    const stale = (await loadOpsChecks(t0)).find(
      (c) => c.key === "backup.pgbackrest",
    )
    expect(stale).toMatchObject({ ok: false, label: "Database backup" })

    expect(await runOpsChecks(t0)).toBe(1)
    const [first] = await alertEmails()
    expect(first!.problems.map((p) => p.label)).toContain("Database backup")

    // Still failing ten minutes later: no repeat yet.
    expect(await runOpsChecks(new Date(t0.getTime() + 10 * 60_000))).toBe(0)

    await getDb().execute(sql`
      update ops_checks set last_ok_at = now(), checked_at = now()
      where key = 'backup.pgbackrest'`)
    expect(await runOpsChecks(new Date(t0.getTime() + 20 * 60_000))).toBe(1)
    const emails = await alertEmails()
    expect(emails.at(-1)!.resolved).toContain("Database backup")

    const row = await getDb().execute<{ alerted_at: Date | null }>(
      sql`select alerted_at from ops_checks where key = 'backup.pgbackrest'`,
    )
    expect(row.rows[0]?.alerted_at).toBeNull()
  })

  it("records the live checks for the System page", async () => {
    await runOpsChecks()
    const keys = await getDb().execute<{ key: string }>(
      sql`select key from ops_checks order by key`,
    )
    expect(keys.rows.map((r) => r.key)).toEqual(
      expect.arrayContaining(["jobs.failed", "jobs.stuck", "worker"]),
    )
  })
})
