import { describe, expect, it } from "vitest"

import { parseServerEnv } from "./env"

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://duis_app:secret@localhost:5432/duis",
  BETTER_AUTH_SECRET: "x".repeat(32),
  SMTP_HOST: "localhost",
  SMTP_PORT: "1025",
  SMTP_FROM: "Duis <no-reply@duis.test>",
  INTERNAL_REVALIDATE_SECRET: "y".repeat(32),
  INTERNAL_REVALIDATE_URLS: "http://localhost:3000",
}

function errorMessage(source: Record<string, string | undefined>): string {
  try {
    parseServerEnv(source)
  } catch (err) {
    return (err as Error).message
  }
  return ""
}

describe("parseServerEnv", () => {
  it("applies defaults for optional settings", () => {
    const env = parseServerEnv(valid)
    expect(env.APP_ENV).toBe("development")
    expect(env.LOG_LEVEL).toBe("info")
    expect(env.DATABASE_POOL_MAX).toBe(10)
    expect(env.SMTP_SECURE).toBe(false)
    expect(env.SMS_PROVIDER).toBe("fake")
    expect(env.SHIPPING_PROVIDER).toBe("fake")
    expect(env.MEDIA_ROOT).toBe("./storage/media")
  })

  it("coerces numbers, booleans and URL lists", () => {
    const env = parseServerEnv({
      ...valid,
      DATABASE_POOL_MAX: "20",
      SMTP_SECURE: "true",
      INTERNAL_REVALIDATE_URLS: "http://web_a:3000, http://web_b:3000",
    })
    expect(env.DATABASE_POOL_MAX).toBe(20)
    expect(env.SMTP_PORT).toBe(1025)
    expect(env.SMTP_SECURE).toBe(true)
    expect(env.INTERNAL_REVALIDATE_URLS).toEqual([
      "http://web_a:3000",
      "http://web_b:3000",
    ])
  })

  it("rejects a non-Postgres database URL", () => {
    expect(
      errorMessage({ ...valid, DATABASE_URL: "mysql://localhost/duis" }),
    ).toMatch(/DATABASE_URL/)
  })

  it("rejects a short auth secret", () => {
    expect(errorMessage({ ...valid, BETTER_AUTH_SECRET: "short" })).toMatch(
      /BETTER_AUTH_SECRET/,
    )
  })

  it("requires Google credentials as a pair", () => {
    expect(errorMessage({ ...valid, GOOGLE_CLIENT_ID: "id" })).toMatch(
      /must be set together/,
    )
  })

  it("enforces production rules", () => {
    const message = errorMessage({ ...valid, APP_ENV: "production" })
    expect(message).toMatch(/https in production/)
    expect(message).toMatch(/SMS_PROVIDER cannot be fake in production/)
    expect(message).toMatch(/SHIPPING_PROVIDER cannot be fake in production/)
    expect(message).toMatch(/PAYMENT_PROVIDER must be razorpay in production/)
  })

  it("needs all three Razorpay values when Razorpay is the provider", () => {
    expect(
      errorMessage({
        ...valid,
        PAYMENT_PROVIDER: "razorpay",
        RAZORPAY_KEY_ID: "rzp_test_abc123",
      }),
    ).toMatch(/needs RAZORPAY_KEY_ID/)
  })

  it("never includes secret values in the error message", () => {
    const message = errorMessage({
      ...valid,
      DATABASE_URL: "mysql://user:hunter2@localhost:3306/duis",
    })
    expect(message).toMatch(/DATABASE_URL/)
    expect(message).not.toContain("hunter2")
  })
})
