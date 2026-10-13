import type { NextConfig } from "next"

// Baseline headers for every response. Caddy adds HSTS and the TLS-related
// headers in production; the CSP (with per-request nonces) is set in proxy.ts
// from Phase 1 onwards.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
]

// The deployment ID is not set here: the Docker build exports
// NEXT_DEPLOYMENT_ID (the git SHA), which Next reads for version-skew
// protection while old and new replicas overlap during a rolling deploy.
const nextConfig: NextConfig = {
  // Self-hosted in Docker: emit .next/standalone with a minimal server.js.
  output: "standalone",
  poweredByHeader: false,
  typedRoutes: true,
  cacheComponents: true,
  partialPrefetching: true,
  // Media is pre-rendered into fixed widths at upload, so next/image never
  // resizes at request time (see doc/02-architecture.md §4.4).
  images: {
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
  },
  // Bundled separately for the worker; keep it as a runtime require on the
  // server so web and worker share one pg-boss build.
  serverExternalPackages: ["pg-boss"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }]
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
}

export default nextConfig
