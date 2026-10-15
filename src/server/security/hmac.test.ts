import { describe, expect, it } from "vitest"

import { signPayload, verifyPayload } from "./hmac"

const SECRET = "s".repeat(32)
const BODY = JSON.stringify({ tags: ["product:1"] })

describe("signed internal payloads", () => {
  it("accepts a fresh, untampered payload", () => {
    const { timestamp, signature } = signPayload(SECRET, BODY)
    expect(verifyPayload(SECRET, BODY, timestamp, signature)).toBe(true)
  })

  it("rejects a modified body, wrong secret or bad signature", () => {
    const { timestamp, signature } = signPayload(SECRET, BODY)
    expect(verifyPayload(SECRET, `${BODY} `, timestamp, signature)).toBe(false)
    expect(verifyPayload("t".repeat(32), BODY, timestamp, signature)).toBe(
      false,
    )
    expect(verifyPayload(SECRET, BODY, timestamp, "00")).toBe(false)
    expect(verifyPayload(SECRET, BODY, null, signature)).toBe(false)
  })

  it("rejects replays older than five minutes", () => {
    const sixMinutesAgo = Date.now() - 6 * 60 * 1000
    const { timestamp, signature } = signPayload(SECRET, BODY, sixMinutesAgo)
    expect(verifyPayload(SECRET, BODY, timestamp, signature)).toBe(false)
  })
})
