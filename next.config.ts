import type { NextConfig } from "next"

import { contentSecurityPolicy } from "./src/lib/csp"

const dev = process.env.NODE_ENV === "development"
const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN

// Baseline headers for every response. Nginx adds HSTS in production. The
// CSP allow-lists sources without nonces, so cached page shells keep working
// (src/lib/csp.ts, ADR-0031).
const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: contentSecurityPolicy({ dev, sentryDsn, frameAncestors: "'none'" }),
  },
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
  // Crawlers that get metadata in <head> before the body streams. This is
  // Next.js's default list plus Googlebot: by default Next streams metadata to
  // Googlebot, which leaves rel=canonical in <body>, where Google ignores it
  // (ADR-020).
  htmlLimitedBots:
    /Googlebot|[\w-]+-Google|Google-[\w-]+|Chrome-Lighthouse|Slurp|DuckDuckBot|baiduspider|yandex|sogou|bitlybot|tumblr|vkShare|quora link preview|redditbot|ia_archiver|Bingbot|BingPreview|applebot|facebookexternalhit|facebookcatalog|Twitterbot|LinkedInBot|Slackbot|Discordbot|WhatsApp|SkypeUriPreview|Yeti|googleweblight/i,
  // Media is pre-rendered into fixed widths at upload, so next/image never
  // resizes at request time (see doc/02-architecture.md §4.4).
  images: {
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // The stored renditions (MEDIA_WIDTHS in the loader). Next's defaults
    // would list 16 widths per srcset that map onto these same five files.
    deviceSizes: [320, 640, 960, 1280, 1920],
    imageSizes: [],
  },
  // Bundled separately for the worker; keep it as a runtime require on the
  // server so web and worker share one pg-boss build.
  serverExternalPackages: ["pg-boss"],
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The CMS builder shows previews in a frame on our own origin. Later
      // entries override earlier ones for the same header.
      {
        source: "/preview/:token",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy({
              dev,
              sentryDsn,
              frameAncestors: "'self'",
            }),
          },
        ],
      },
    ]
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
