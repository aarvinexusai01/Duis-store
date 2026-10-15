import { sql } from "drizzle-orm"
import { fromDrizzle, type PgBoss } from "pg-boss"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { scheduleCollectionRefresh } from "@/features/collections"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { createBoss } from "@/server/jobs/boss"
import { QUEUES } from "@/server/jobs/queues"

import { closeConnectionsAfterAll } from "../helpers/cleanup"

closeConnectionsAfterAll()

const QUEUE = `test.transactional-enqueue.${process.pid}`
const RETRY_QUEUE = `test.retry.${process.pid}`

let worker: PgBoss

beforeAll(async () => {
  worker = createBoss("worker")
  await worker.start()
  await worker.createQueue(QUEUE)
  await worker.createQueue(RETRY_QUEUE, { retryLimit: 2, retryDelay: 1 })
})

afterAll(async () => {
  await worker.deleteQueue(QUEUE)
  await worker.deleteQueue(RETRY_QUEUE)
  await worker.stop({ graceful: false })
})

describe("job queue", () => {
  it("installs every queue with its retry and dead-letter policy", async () => {
    const email = await worker.getQueue(QUEUES.notifyEmail)
    expect(email).toMatchObject({
      retryLimit: 5,
      deadLetter: QUEUES.deadLetter,
    })
    expect(await worker.getQueue(QUEUES.expireReservations)).not.toBeNull()
    expect(await worker.getQueue(QUEUES.refreshAutoCollections)).toMatchObject({
      policy: "stately",
    })
  })

  it("coalesces a burst of collection refreshes into one queued job", async () => {
    // Through the real entry point: its singletonKey is what other test files
    // (and production) use, so concurrent refreshes share one slot.
    for (let i = 0; i < 5; i++) await scheduleCollectionRefresh()
    const queued = await getDb().execute<{ count: number }>(sql`
      select count(*)::int as count from pgboss.job
      where name = ${QUEUES.refreshAutoCollections} and state = 'created'
    `)
    expect(queued.rows[0]!.count).toBe(1)
  })

  // ADR-0015: a job exists if and only if the change that caused it commits.
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

  it("retries a failed job, then completes it", async () => {
    let attempts = 0
    await worker.work(
      RETRY_QUEUE,
      { pollingIntervalSeconds: 0.5 },
      async () => {
        attempts++
        if (attempts === 1) throw new Error("transient failure")
      },
    )
    const jobId = await worker.send(RETRY_QUEUE, { ok: true })

    await vi.waitFor(
      async () => {
        const job = await worker.getJobById(RETRY_QUEUE, jobId!)
        expect(job?.state).toBe("completed")
      },
      { timeout: 20_000, interval: 250 },
    )
    expect(attempts).toBe(2)
    await worker.offWork(RETRY_QUEUE)
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
