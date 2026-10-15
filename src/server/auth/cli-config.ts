// Entry point for the Better Auth CLI (`npm run auth:generate`), which needs
// an exported `auth` instance to derive the database schema. It never runs in
// the app and never connects anywhere.
import { betterAuth } from "better-auth"
import { drizzleAdapter } from "better-auth/adapters/drizzle"

import { buildAuthOptions } from "./options"

const noop = async () => {}

export const auth = betterAuth(
  buildAuthOptions({
    appUrl: "http://localhost:3000",
    secret: "schema-generation-only-not-a-real-secret",
    database: drizzleAdapter({} as never, { provider: "pg", usePlural: true }),
    secureCookies: false,
    rateLimitEnabled: true,
    sendVerificationEmail: noop,
    sendResetPasswordEmail: noop,
    sendPhoneOtp: noop,
  }),
)
