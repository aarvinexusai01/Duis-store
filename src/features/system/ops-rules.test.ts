import { describe, expect, it } from "vitest"

import { evaluateOps, planAlerts, type OpsRow } from "./ops-rules"

const now = new Date("2026-10-21T06:00:00Z")
const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000)

function row(key: string, patch: Partial<OpsRow> = {}): OpsRow {
  return {
    key,
    ok: true,
    detail: null,
    checkedAt: hoursAgo(0.1),
    lastOkAt: hoursAgo(0.1),
    alertedAt: null,
    ...patch,
  }
}

const byKey = (rows: OpsRow[], expectExternal = true) =>
  new Map(evaluateOps(rows, now, { expectExternal }).map((c) => [c.key, c]))

describe("evaluateOps", () => {
  it("fails a backup whose last success is too old", () => {
    const checks = byKey([
      row("backup.pgbackrest", { lastOkAt: hoursAgo(27) }),
      row("backup.restic", { lastOkAt: hoursAgo(20) }),
    ])
    expect(checks.get("backup.pgbackrest")).toMatchObject({ ok: false })
    expect(checks.get("backup.pgbackrest")?.detail).toMatch(/No success since/)
    expect(checks.get("backup.restic")?.ok).toBe(true)
  })

  it("treats missing backup and host rows as failing only on a real server", () => {
    expect(byKey([]).get("backup.drill")).toMatchObject({
      ok: false,
      detail: "Has never succeeded.",
    })
    expect(byKey([]).get("host.disk")?.ok).toBe(false)
    expect(byKey([], false).has("backup.drill")).toBe(false)
  })

  it("notices when the host check stops reporting", () => {
    const checks = byKey([row("host.disk", { checkedAt: hoursAgo(2) })])
    expect(checks.get("host.disk")).toMatchObject({ ok: false })
    expect(checks.get("host.disk")?.detail).toMatch(/stopped reporting/)
  })

  it("keeps a failing row's own explanation", () => {
    const checks = byKey([
      row("host.disk", { ok: false, detail: "Disk 91% full (/)." }),
    ])
    expect(checks.get("host.disk")).toMatchObject({
      ok: false,
      detail: "Disk 91% full (/).",
    })
  })
})

describe("planAlerts", () => {
  const failing = { key: "worker", label: "Background worker", ok: false }
  const fine = { key: "jobs.stuck", label: "Job queues", ok: true }
  const base = { detail: null, checkedAt: now, lastOkAt: null }

  it("alerts once, repeats after six hours, and reports recovery", () => {
    const checks = [
      { ...base, ...failing },
      { ...base, ...fine },
    ]
    expect(planAlerts(checks, new Map(), now).alert).toHaveLength(1)
    expect(
      planAlerts(checks, new Map([["worker", hoursAgo(1)]]), now).alert,
    ).toHaveLength(0)
    expect(
      planAlerts(checks, new Map([["worker", hoursAgo(6)]]), now).alert,
    ).toHaveLength(1)
    expect(
      planAlerts(checks, new Map([["jobs.stuck", hoursAgo(1)]]), now).resolved,
    ).toEqual([expect.objectContaining({ key: "jobs.stuck" })])
  })
})
