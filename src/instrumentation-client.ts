/**
 * Browser error reporting (doc/07 §7). The DSN is public and baked in at
 * build time (ops/deploy.sh passes it); without one, Sentry is never loaded.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  void Promise.all([
    import("@sentry/nextjs"),
    import("@/lib/sentry-scrub"),
  ]).then(([Sentry, { scrubEvent, SENTRY_DATA_COLLECTION }]) => {
    Sentry.init({
      dsn,
      environment: process.env.NEXT_PUBLIC_APP_ENV,
      release: process.env.NEXT_PUBLIC_APP_SHA,
      dataCollection: SENTRY_DATA_COLLECTION,
      tracesSampleRate: 0,
      beforeSend: scrubEvent,
      // Extensions and old browsers throw noise that isn't ours.
      allowUrls: [window.location.origin],
    })
  })
}
