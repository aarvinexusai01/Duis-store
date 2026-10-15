import "server-only"

import { getServerEnv } from "@/config/env"
import type { Transaction } from "@/server/db/transaction"
import { enqueue } from "@/server/jobs/enqueue"
import { QUEUES } from "@/server/jobs/queues"
import {
  SIGNATURE_HEADER,
  signPayload,
  TIMESTAMP_HEADER,
} from "@/server/security/hmac"

import { CACHE_TAG } from "./tags"

let suppressed = false

/** For bulk scripts (the seed) that run before anything has been cached. */
export function suppressRevalidation(value = true): void {
  suppressed = value
}

/**
 * Asks every web replica to drop cached data for these tags (ADR-008).
 * Pass `tx` so the request is only sent if the change commits.
 */
export async function requestRevalidation(
  tags: readonly string[],
  options: { tx?: Transaction } = {},
): Promise<void> {
  if (suppressed) return
  const unique = [...new Set(tags)].filter((tag) => CACHE_TAG.test(tag))
  if (unique.length === 0) return
  await enqueue(QUEUES.cacheRevalidate, { tags: unique }, { tx: options.tx })
}

/**
 * Worker side of cache.revalidate: a signed POST to each replica. Any failure
 * fails the job so pg-boss retries; revalidating twice is harmless.
 */
export async function fanOutRevalidation(
  tags: readonly string[],
): Promise<void> {
  const env = getServerEnv()
  const body = JSON.stringify({ tags })

  const results = await Promise.allSettled(
    env.INTERNAL_REVALIDATE_URLS.map(async (base) => {
      const { timestamp, signature } = signPayload(
        env.INTERNAL_REVALIDATE_SECRET,
        body,
      )
      const response = await fetch(new URL("/api/internal/revalidate", base), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [TIMESTAMP_HEADER]: timestamp,
          [SIGNATURE_HEADER]: signature,
        },
        body,
        signal: AbortSignal.timeout(5_000),
      })
      if (!response.ok) throw new Error(`${base} answered ${response.status}`)
    }),
  )

  const failures = results.filter((result) => result.status === "rejected")
  if (failures.length > 0) {
    throw new AggregateError(
      failures.map((failure) => failure.reason),
      `cache revalidation failed on ${failures.length} replica(s)`,
    )
  }
}
