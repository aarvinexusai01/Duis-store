import { eq, sql } from "drizzle-orm"
import { describe, expect, it } from "vitest"

import { notificationLogs, users } from "@/db/schema"
import { getAuth } from "@/server/auth/auth"
import { actorFromHeaders } from "@/server/auth/session"
import { getDb } from "@/server/db/client"
import { isDomainError } from "@/server/errors"
import { lastFakeOtp } from "@/server/notifications/sms"
import { authorize } from "@/server/operation"

import { unique } from "../helpers/actors"
import { closeConnectionsAfterAll } from "../helpers/cleanup"
import { secretFromUri, totp } from "../helpers/totp"

closeConnectionsAfterAll()

const PASSWORD = "correct-horse-battery-9"

/** Turns a Better Auth response's Set-Cookie into request headers. */
function sessionHeaders(response: Response): Headers {
  const cookies = response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ")
  return new Headers({ cookie: cookies })
}

/** The verification link queued for an address (read from the job queue). */
async function queuedLink(email: string): Promise<URL> {
  const result = await getDb().execute<{ url: string }>(sql`
    select data->'props'->>'url' as url from pgboss.job
    where name = 'notify.email' and data->>'to' = ${email}
    order by created_on desc limit 1
  `)
  return new URL(result.rows[0]!.url)
}

async function signUpVerified(email: string) {
  const auth = getAuth()
  await auth.api.signUpEmail({
    body: { email, password: PASSWORD, name: "Test Shopper" },
  })
  const token = (await queuedLink(email)).searchParams.get("token")!
  await auth.api.verifyEmail({ query: { token } })
}

describe("email and password", () => {
  it("queues a verification email and refuses sign-in until verified", async () => {
    const auth = getAuth()
    const email = `${unique("shopper")}@duis.test`
    await auth.api.signUpEmail({
      body: { email, password: PASSWORD, name: "Test Shopper" },
    })

    const [log] = await getDb()
      .select()
      .from(notificationLogs)
      .where(eq(notificationLogs.template, "verify-email"))
      .orderBy(sql`${notificationLogs.createdAt} desc`)
      .limit(1)
    expect(log).toMatchObject({ channel: "email", status: "queued" })
    expect(log!.recipient).not.toContain(email.split("@")[0])

    await expect(
      auth.api.signInEmail({ body: { email, password: PASSWORD } }),
    ).rejects.toThrow()
  })

  it("signs a verified customer in", async () => {
    const auth = getAuth()
    const email = `${unique("shopper")}@duis.test`
    await signUpVerified(email)

    const response = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    })
    expect(response.status).toBe(200)

    const actor = await actorFromHeaders(sessionHeaders(response))
    expect(actor).toMatchObject({ kind: "user", roles: ["customer"] })
  })

  it("rejects a wrong password", async () => {
    const auth = getAuth()
    const email = `${unique("shopper")}@duis.test`
    await signUpVerified(email)
    await expect(
      auth.api.signInEmail({ body: { email, password: "not-the-password" } }),
    ).rejects.toThrow()
  })
})

describe("phone OTP", () => {
  it("signs up a customer with an Indian mobile number", async () => {
    const auth = getAuth()
    const phoneNumber = `+9198${String(Date.now()).slice(-8)}`
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } })
    const code = lastFakeOtp(phoneNumber)
    expect(code).toMatch(/^\d{6}$/)

    const response = await auth.api.verifyPhoneNumber({
      body: { phoneNumber, code: code! },
      asResponse: true,
    })
    expect(response.status).toBe(200)
    const actor = await actorFromHeaders(sessionHeaders(response))
    expect(actor).toMatchObject({ kind: "user", roles: ["customer"] })
  })

  it("rejects non-Indian numbers and wrong codes", async () => {
    const auth = getAuth()
    await expect(
      auth.api.sendPhoneNumberOTP({ body: { phoneNumber: "+14155550123" } }),
    ).rejects.toThrow()

    const phoneNumber = `+9197${String(Date.now()).slice(-8)}`
    await auth.api.sendPhoneNumberOTP({ body: { phoneNumber } })
    const wrong = lastFakeOtp(phoneNumber) === "000000" ? "111111" : "000000"
    await expect(
      auth.api.verifyPhoneNumber({ body: { phoneNumber, code: wrong } }),
    ).rejects.toThrow()
  })
})

describe("staff two-factor authentication", () => {
  it("blocks staff permissions until TOTP is enabled, then requires it to sign in", async () => {
    const auth = getAuth()
    const email = `${unique("admin")}@duis.test`
    await signUpVerified(email)
    await getDb()
      .update(users)
      .set({ role: "store_admin" })
      .where(eq(users.email, email))

    const signIn = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
      asResponse: true,
    })
    const headers = sessionHeaders(signIn)

    const before = await actorFromHeaders(headers)
    let code: string | undefined
    try {
      authorize(before, { catalog: ["create"] })
    } catch (err) {
      code = isDomainError(err) ? err.code : undefined
    }
    expect(code).toBe("STAFF_2FA_REQUIRED")

    const enabled = await auth.api.enableTwoFactor({
      body: { password: PASSWORD },
      headers,
    })
    if (!("totpURI" in enabled)) throw new Error("expected TOTP enrolment")
    const { totpURI } = enabled
    // Verifying TOTP rotates the session, so continue with the new cookie.
    const verified = await auth.api.verifyTOTP({
      body: { code: totp(secretFromUri(totpURI)) },
      headers,
      asResponse: true,
    })
    expect(verified.status).toBe(200)
    expect(await actorFromHeaders(headers)).toMatchObject({ kind: "anonymous" })

    const after = await actorFromHeaders(sessionHeaders(verified))
    expect(after).toMatchObject({ kind: "user", twoFactorEnabled: true })
    expect(() => authorize(after, { catalog: ["create"] })).not.toThrow()

    // A fresh sign-in now stops at the second factor: no session yet.
    const second = await auth.api.signInEmail({
      body: { email, password: PASSWORD },
    })
    expect(second).toMatchObject({ twoFactorRedirect: true })
  })
})
