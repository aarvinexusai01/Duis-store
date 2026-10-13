// Stand-in for the `server-only` package outside Next.js (Vitest and the
// worker/migrate bundles). The real package throws unless it is resolved with
// the react-server condition, which only Next.js applies.
export {}
