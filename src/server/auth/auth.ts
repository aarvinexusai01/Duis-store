import "server-only"
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import { getServerEnv } from "@/config/env"
import * as schema from "@/db/schema"
import { getDb } from "@/server/db/client"
import { queueEmail } from "@/server/notifications/email"
import { sendOtpSms } from "@/server/notifications/sms"

import { buildAuthOptions } from "./options"
import { guardOtpRequest } from "./otp-guard"

function createAuth() {
  const env = getServerEnv()
  return betterAuth(
    buildAuthOptions({
      appUrl: env.APP_URL,
      secret: env.BETTER_AUTH_SECRET,
      database: drizzleAdapter(getDb(), {
        provider: "pg",
        schema,
        usePlural: true,
      }),
      secureCookies: env.APP_URL.startsWith("https://"),
      // Tests exercise auth flows in bulk from one address.
      rateLimitEnabled: env.APP_ENV !== "test",
      google:
        env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
          ? {
              clientId: env.GOOGLE_CLIENT_ID,
              clientSecret: env.GOOGLE_CLIENT_SECRET,
            }
          : undefined,
      sendVerificationEmail: async ({ to, name, url }) => {
        await queueEmail({ template: "verify-email", to, props: { name, url } })
      },
      sendResetPasswordEmail: async ({ to, name, url }) => {
        await queueEmail({
          template: "reset-password",
          to,
          props: { name, url },
        })
      },
      sendPhoneOtp: ({ phoneNumber, code }) => sendOtpSms(phoneNumber, code),
      guardOtpRequest,
      turnstileSecretKey: env.TURNSTILE_SECRET_KEY,
    }),
  )
}

export type Auth = ReturnType<typeof createAuth>

const globalForAuth = globalThis as typeof globalThis & { __duisAuth?: Auth }

/** Created on first use so importing auth never needs configuration. */
export function getAuth(): Auth {
  globalForAuth.__duisAuth ??= createAuth()
  return globalForAuth.__duisAuth
}
