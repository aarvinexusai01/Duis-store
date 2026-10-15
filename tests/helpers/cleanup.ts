import { afterAll } from "vitest"

import { closeDb } from "@/server/db/client"
import { stopSender } from "@/server/jobs/enqueue"

/** Closes the pools a test file opened (database and job sender). */
export function closeConnectionsAfterAll(): void {
  afterAll(async () => {
    await stopSender()
    await closeDb()
  })
}
