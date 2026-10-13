import { describe, expect, it } from "vitest"

import { parseServerEnv } from "./env"

const valid = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://duis_app:secret@localhost:5432/duis",
}

describe("parseServerEnv", () => {
  it("applies defaults for optional settings", () => {
    const env = parseServerEnv(valid)
    expect(env.APP_ENV).toBe("development")
    expect(env.LOG_LEVEL).toBe("info")
    expect(env.DATABASE_POOL_MAX).toBe(10)
    expect(env.SMTP_SECURE).toBe(false)
  })

  it("coerces numeric and boolean strings", () => {
    const env = parseServerEnv({
      ...valid,
      DATABASE_POOL_MAX: "20",
      SMTP_HOST: "localhost",
      SMTP_PORT: "1025",
      SMTP_FROM: "Duis <orders@example.com>",
      SMTP_SECURE: "true",
    })
    expect(env.DATABASE_POOL_MAX).toBe(20)
    expect(env.SMTP_PORT).toBe(1025)
    expect(env.SMTP_SECURE).toBe(true)
  })

  it("rejects a non-Postgres database URL", () => {
    expect(() =>
      parseServerEnv({ ...valid, DATABASE_URL: "mysql://localhost/duis" }),
    ).toThrow(/DATABASE_URL/)
  })

  it("requires SMTP settings to be complete", () => {
    expect(() => parseServerEnv({ ...valid, SMTP_HOST: "localhost" })).toThrow(
      /must be set together/,
    )
  })

  it("requires https in production", () => {
    expect(() => parseServerEnv({ ...valid, APP_ENV: "production" })).toThrow(
      /https in production/,
    )
  })

  it("never includes secret values in the error message", () => {
    let message = ""
    try {
      parseServerEnv({
        ...valid,
        DATABASE_URL: "mysql://user:hunter2@localhost:3306/duis",
      })
    } catch (err) {
      message = (err as Error).message
    }
    expect(message).toMatch(/DATABASE_URL/)
    expect(message).not.toContain("hunter2")
  })
})
