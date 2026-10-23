import { sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { OWNER_CHARTS } from "@/lib/owner-size-charts.fixture"
import { getDb } from "@/server/db/client"

import { closeConnectionsAfterAll } from "../helpers/cleanup"

closeConnectionsAfterAll()

/** Migration 0016_owner_size_charts stored exactly the owner's charts. */
describe("the owner's size charts", () => {
  it.each(Object.entries(OWNER_CHARTS))(
    "%s is stored in inches with the right sizes and values",
    async (name, { inches }) => {
      const { rows } = await getDb().execute<{
        unit: string
        chart: { columns: string[]; rows: { size: string; values: string[] }[] }
        how_to_measure: string | null
      }>(
        sql`select unit, chart, how_to_measure from size_charts where name = ${name}`,
      )
      expect(rows).toHaveLength(1)
      const stored = rows[0]!
      expect(stored.unit).toBe("in")
      expect(stored.chart.columns).toEqual([
        "Chest",
        "Front Length",
        "Sleeve Length",
      ])
      expect(stored.chart.rows.map((r) => r.size)).toEqual([
        "S",
        "M",
        "L",
        "XL",
        "2XL",
        "3XL",
      ])
      expect(stored.chart.rows.map((r) => r.values)).toEqual(inches)
      expect(stored.how_to_measure).toMatch(/Chest: measure around/)
    },
  )
})
