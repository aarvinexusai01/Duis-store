import { describe, expect, it } from "vitest"

import { scrubEvent, scrubText } from "./sentry-scrub"

describe("scrubText", () => {
  it("hides emails, phone numbers and secrets in links", () => {
    expect(scrubText("mail ravi.k+1@example.co.in now")).toBe(
      "mail [email] now",
    )
    expect(scrubText("call +91 9876543210 or 9876543210")).toBe(
      "call [phone] or [phone]",
    )
    expect(
      scrubText("https://duis.in/api/auth/reset?token=abc123&next=/account"),
    ).toBe("https://duis.in/api/auth/reset?token=[redacted]&next=/account")
    expect(scrubText("/preview/3f2a.1700000000.c0ffee")).toBe(
      "/preview/[redacted]",
    )
  })

  it("leaves ordinary text alone", () => {
    expect(
      scrubText("Cannot read properties of undefined (reading 'id')"),
    ).toBe("Cannot read properties of undefined (reading 'id')")
    expect(scrubText("order DU-10042 failed")).toBe("order DU-10042 failed")
  })
})

describe("scrubEvent", () => {
  it("drops cookies, bodies, risky headers and user details", () => {
    const event = scrubEvent({
      message: "Payment for a@b.com failed",
      user: { id: "u1", email: "a@b.com", ip_address: "1.2.3.4" },
      request: {
        url: "https://duis.in/checkout?otp=123456",
        cookies: { session: "x" },
        data: { phone: "9876543210" },
        query_string: "otp=123456",
        headers: {
          "User-Agent": "Mozilla",
          Cookie: "session=x",
          Authorization: "Bearer y",
          "X-Real-IP": "1.2.3.4",
        },
      },
      exception: { values: [{ value: "No user 9876543210" }] },
      breadcrumbs: [
        { message: "fetch", data: { url: "/api?token=t", to: "a@b.com" } },
      ],
    })
    expect(event).toEqual({
      message: "Payment for [email] failed",
      user: { id: "u1" },
      request: {
        url: "https://duis.in/checkout?otp=[redacted]",
        query_string: "otp=[redacted]",
        headers: { "User-Agent": "Mozilla" },
      },
      exception: { values: [{ value: "No user [phone]" }] },
      breadcrumbs: [
        {
          message: "fetch",
          data: { url: "/api?token=[redacted]", to: "[email]" },
        },
      ],
    })
  })
})
