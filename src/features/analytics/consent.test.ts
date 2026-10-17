import { describe, expect, it } from "vitest"

import { CONSENT_VERSION, formatConsent, parseConsent } from "./consent"

const visitorId = "0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b"

describe("consent cookie", () => {
  it("round-trips every combination", () => {
    for (const analytics of [true, false]) {
      for (const marketing of [true, false]) {
        const stored = { analytics, marketing, visitorId }
        expect(parseConsent(formatConsent(stored))).toEqual(stored)
      }
    }
  })

  it("treats missing, malformed and old answers as no answer", () => {
    expect(parseConsent(undefined)).toBeNull()
    expect(parseConsent("")).toBeNull()
    expect(parseConsent(`${CONSENT_VERSION}.12.${visitorId}`)).toBeNull()
    expect(parseConsent(`${CONSENT_VERSION}.11.not-a-uuid`)).toBeNull()
    expect(parseConsent(`${CONSENT_VERSION + 1}.11.${visitorId}`)).toBeNull()
    expect(parseConsent(`0.11.${visitorId}`)).toBeNull()
  })
})
