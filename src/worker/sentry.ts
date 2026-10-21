import * as Sentry from "@sentry/node"

import type { ServerEnv } from "@/config/env"
import { scrubEvent, SENTRY_DATA_COLLECTION } from "@/lib/sentry-scrub"

/** Error reporting for the worker (doc/07 §7); off while SENTRY_DSN is unset. */

let enabled = false

export function initWorkerSentry(env: ServerEnv): void {
  if (!env.SENTRY_DSN) return
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: process.env.APP_SHA,
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: 0,
    beforeSend: scrubEvent,
    initialScope: { tags: { service: "worker" } },
  })
  enabled = true
}

/** A job attempt failed; pg-boss retries it, Sentry groups the repeats. */
export function reportJobError(
  err: unknown,
  job: { queue: string; id: string },
): void {
  if (!enabled) return
  Sentry.captureException(err, {
    tags: { queue: job.queue },
    extra: { jobId: job.id },
  })
}

export async function flushWorkerSentry(): Promise<void> {
  if (enabled) await Sentry.close(2_000)
}
