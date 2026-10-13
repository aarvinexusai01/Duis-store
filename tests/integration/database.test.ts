import { afterAll, describe, expect, it } from "vitest"

import { closeDb, getPool } from "@/server/db/client"
import { checkReadiness } from "@/server/health"

afterAll(async () => {
  await closeDb()
})

describe("database as the runtime role", () => {
  it("connects as the least-privileged app role", async () => {
    const { rows } = await getPool().query<{ current_user: string }>(
      "select current_user",
    )
    expect(rows[0]?.current_user).toBe("duis_app")
  })

  it("has the extensions the catalogue and search rely on", async () => {
    const { rows } = await getPool().query<{ extname: string }>(
      "select extname from pg_extension",
    )
    expect(rows.map((row) => row.extname)).toEqual(
      expect.arrayContaining(["pg_trgm", "unaccent", "ltree", "citext"]),
    )
  })

  it("generates time-ordered UUIDs natively (PostgreSQL 18)", async () => {
    const { rows } = await getPool().query<{ id: string }>(
      "select uuidv7()::text as id",
    )
    expect(rows[0]?.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-/)
  })

  it("cannot run DDL in the public schema", async () => {
    await expect(
      getPool().query("create table phase0_must_fail (id integer)"),
    ).rejects.toThrow(/permission denied/)
  })

  it("reports readiness", async () => {
    await expect(checkReadiness()).resolves.toEqual({
      status: "ok",
      checks: { database: "ok" },
    })
  })
})
