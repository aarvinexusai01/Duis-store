import { describe, expect, it } from "vitest"

import { contentSecurityPolicy } from "./csp"

function parse(policy: string): Map<string, string[]> {
  return new Map(
    policy.split("; ").map((part) => {
      const [name, ...sources] = part.split(" ")
      return [name!, sources]
    }),
  )
}

describe("contentSecurityPolicy", () => {
  const prod = parse(
    contentSecurityPolicy({
      dev: false,
      sentryDsn: "https://abc@o1.ingest.de.sentry.io/42",
      frameAncestors: "'none'",
    }),
  )

  it("blocks plugins, base hijacking and framing", () => {
    expect(prod.get("object-src")).toEqual(["'none'"])
    expect(prod.get("base-uri")).toEqual(["'self'"])
    expect(prod.get("frame-ancestors")).toEqual(["'none'"])
    expect(prod.get("default-src")).toEqual(["'self'"])
  })

  it("allows the payment, analytics, captcha and embed providers", () => {
    expect(prod.get("script-src")).toEqual(
      expect.arrayContaining([
        "https://*.razorpay.com",
        "https://www.googletagmanager.com",
        "https://connect.facebook.net",
        "https://challenges.cloudflare.com",
        "https://www.instagram.com",
      ]),
    )
    expect(prod.get("frame-src")).toEqual(
      expect.arrayContaining([
        // The CMS editors' preview frames.
        "'self'",
        "https://*.razorpay.com",
        "https://www.youtube-nocookie.com",
      ]),
    )
    expect(prod.get("connect-src")).toContain("https://o1.ingest.de.sentry.io")
  })

  it("allows eval only in development", () => {
    expect(prod.get("script-src")).not.toContain("'unsafe-eval'")
    const dev = parse(
      contentSecurityPolicy({ dev: true, frameAncestors: "'self'" }),
    )
    expect(dev.get("script-src")).toContain("'unsafe-eval'")
    expect(dev.get("frame-ancestors")).toEqual(["'self'"])
    expect(dev.get("connect-src")).not.toContain("null")
  })
})
