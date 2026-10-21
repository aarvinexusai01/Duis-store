import type { Instrumentation } from "next"

/**
 * Runs once when a server instance starts. Validates configuration so a
 * misconfigured replica fails its health check instead of serving errors,
 * then starts error reporting if SENTRY_DSN is set (doc/07 §7).
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  // Builds run without runtime secrets; validation happens on server start.
  if (process.env.NEXT_PHASE === "phase-production-build") return

  const { getServerEnv } = await import("@/config/env")
  const env = getServerEnv()
  if (!env.SENTRY_DSN) return

  const [Sentry, { scrubEvent, SENTRY_DATA_COLLECTION }] = await Promise.all([
    import("@sentry/nextjs"),
    import("@/lib/sentry-scrub"),
  ])
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.APP_ENV,
    release: process.env.APP_SHA,
    dataCollection: SENTRY_DATA_COLLECTION,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
    beforeSend: scrubEvent,
    beforeSendTransaction: scrubEvent,
    initialScope: { tags: { service: "web" } },
  })
}

/** Errors thrown while rendering or in route handlers and Server Actions. */
export const onRequestError: Instrumentation.onRequestError = async (
  ...args
) => {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !process.env.SENTRY_DSN) return
  const Sentry = await import("@sentry/nextjs")
  Sentry.captureRequestError(...args)
}
