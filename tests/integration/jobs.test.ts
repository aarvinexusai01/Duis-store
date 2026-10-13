import { sql } from "drizzle-orm"
import { fromDrizzle, type PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { closeDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { createBoss } from "@/server/jobs/boss"

// ADR-0015: jobs are enqueued inside the business transaction, so a job
// exists if and only if the change that caused it was committed.
const QUEUE = `test.transactional-enqueue.${process.pid}`

let worker: PgBoss

beforeAll(async () => {
  worker = createBoss("worker")
  await worker.start()
  await worker.createQueue(QUEUE)
})

afterAll(async () => {
  await worker.deleteQueue(QUEUE)
  await worker.stop({ graceful: false })
  await closeDb()
})

describe("job queue", () => {
  it("keeps a job only when the surrounding transaction commits", async () => {
    await expect(
      withTransaction(async (tx) => {
        await worker.send(
          QUEUE,
          { outcome: "rolled-back" },
          { db: fromDrizzle(tx, sql) },
        )
        throw new Error("abort")
      }),
    ).rejects.toThrow("abort")

    await withTransaction(async (tx) => {
      await worker.send(
        QUEUE,
        { outcome: "committed" },
        { db: fromDrizzle(tx, sql) },
      )
    })

    const jobs = await worker.fetch<{ outcome: string }>(QUEUE, {
      batchSize: 10,
    })
    expect(jobs.map((job) => job.data.outcome)).toEqual(["committed"])
  })

  it("lets the web role send without migrating or supervising", async () => {
    const web = createBoss("web")
    await web.start()
    try {
      await expect(web.send(QUEUE, { from: "web" })).resolves.toEqual(
        expect.any(String),
      )
    } finally {
      await web.stop({ graceful: false })
    }
  })
})
