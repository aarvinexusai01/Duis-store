import type { BetterAuthOptions } from "better-auth"
import { APIError, createAuthMiddleware } from "better-auth/api"
import { nextCookies } from "better-auth/next-js"
import { admin, captcha, phoneNumber, twoFactor } from "better-auth/plugins"

import { ac, roleDefinitions } from "./permissions"

/**
 * Better Auth configuration as a pure function of its dependencies, so the
 * same options serve the app (src/server/auth/auth.ts) and the schema
 * generator (src/server/auth/cli-config.ts) without reading the environment.
 */
export type AuthDependencies = {
  appUrl: string
  secret: string
  database: BetterAuthOptions["database"]
  secureCookies: boolean
  rateLimitEnabled: boolean
  google?: { clientId: string; clientSecret: string }
  sendVerificationEmail(message: AuthEmail): Promise<void>
  sendResetPasswordEmail(message: AuthEmail): Promise<void>
  sendPhoneOtp(message: { phoneNumber: string; code: string }): Promise<void>
  /** Per-phone and per-IP limits for login codes: null to allow, else why not. */
  guardOtpRequest(
    phoneNumber: string,
    ip: string | null,
  ): Promise<string | null>
  /** Cloudflare Turnstile, when its keys are set. */
  turnstileSecretKey?: string
  /**
   * DPDP (doc/06 Phase 12): the sign-up boxes were ticked (a cookie set by
   * the form), and recording that consent once the account is known.
   */
  hasAccountConsent(headers: Headers): boolean
  recordAccountConsent(
    userId: string,
    headers: Headers,
    source: string,
  ): Promise<void>
}

export type AuthEmail = { to: string; name: string; url: string }

// Phone OTP is offered for Indian mobile numbers only: OTP SMS goes through a
// DLT-registered Indian sender. International customers use email or Google.
export const INDIAN_MOBILE = /^\+91[6-9]\d{9}$/

const DAY = 60 * 60 * 24

// Where a browser hands over personal data to sign up or sign in: each needs
// the account and age boxes ticked first (DPDP Act s.6).
const CONSENT_PATHS = new Set([
  "/sign-up/email",
  "/phone-number/send-otp",
  "/sign-in/social",
])
// Where a session starts for someone who may not have consented yet.
const SIGN_IN_PATHS = new Set(["/phone-number/verify", "/callback/:id"])

export function buildAuthOptions(deps: AuthDependencies) {
  return {
    appName: "Duis",
    baseURL: deps.appUrl,
    secret: deps.secret,
    trustedOrigins: [deps.appUrl],
    database: deps.database,
    telemetry: { enabled: false },

    advanced: {
      cookiePrefix: "duis",
      useSecureCookies: deps.secureCookies,
      database: { generateId: "uuid" },
      // Nginx sets X-Real-IP from Cloudflare's CF-Connecting-IP (doc/07 §5).
      ipAddress: { ipAddressHeaders: ["x-real-ip"] },
    },

    session: {
      expiresIn: 30 * DAY,
      updateAge: DAY,
    },

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      revokeSessionsOnPasswordReset: true,
      resetPasswordTokenExpiresIn: 60 * 60,
      sendResetPassword: async ({ user, url }) => {
        await deps.sendResetPasswordEmail({
          to: user.email,
          name: user.name,
          url,
        })
      },
    },

    emailVerification: {
      sendOnSignUp: true,
      sendOnSignIn: true,
      autoSignInAfterVerification: true,
      expiresIn: DAY,
      sendVerificationEmail: async ({ user, url }) => {
        await deps.sendVerificationEmail({
          to: user.email,
          name: user.name,
          url,
        })
      },
    },

    socialProviders: deps.google
      ? {
          google: {
            clientId: deps.google.clientId,
            clientSecret: deps.google.clientSecret,
          },
        }
      : {},

    account: {
      accountLinking: { enabled: true, trustedProviders: ["google"] },
    },

    rateLimit: {
      enabled: deps.rateLimitEnabled,
      storage: "database",
      window: 60,
      max: 100,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 3 },
        "/phone-number/send-otp": { window: 60, max: 3 },
        "/phone-number/verify": { window: 60, max: 5 },
        "/two-factor/verify-totp": { window: 60, max: 5 },
      },
    },

    databaseHooks: {
      user: {
        create: {
          after: async (user, ctx) => {
            const headers = ctx?.request?.headers ?? ctx?.headers
            if (headers)
              await deps.recordAccountConsent(user.id, headers, "sign_up")
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        // Server-side calls (staff invitations) carry no browser request.
        if (
          CONSENT_PATHS.has(ctx.path) &&
          ctx.request &&
          !deps.hasAccountConsent(ctx.request.headers)
        ) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Please tick the boxes to agree to the Privacy Notice and confirm you are 18 or older.",
          })
        }
        if (ctx.path !== "/phone-number/send-otp") return
        const phone = (ctx.body as { phoneNumber?: unknown } | undefined)
          ?.phoneNumber
        if (typeof phone !== "string") return
        const ip = ctx.request?.headers.get("x-real-ip") ?? null
        const refused = await deps.guardOtpRequest(phone, ip)
        if (refused)
          throw new APIError("TOO_MANY_REQUESTS", { message: refused })
      }),
      after: createAuthMiddleware(async (ctx) => {
        if (!SIGN_IN_PATHS.has(ctx.path) || !ctx.request) return
        const userId = ctx.context.newSession?.user.id
        if (userId)
          await deps.recordAccountConsent(
            userId,
            ctx.request.headers,
            "sign_in",
          )
      }),
    },

    plugins: [
      // Always present (a conditional entry breaks the inferred session
      // type). Without a Turnstile key it guards a path that never exists:
      // an empty list would fall back to the plugin's defaults.
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: deps.turnstileSecretKey ?? "turnstile-off",
        endpoints: deps.turnstileSecretKey
          ? [
              "/phone-number/send-otp",
              "/sign-up/email",
              "/request-password-reset",
            ]
          : ["/__turnstile-off"],
      }),
      admin({
        ac,
        roles: roleDefinitions,
        defaultRole: "customer",
        adminRoles: ["super_admin"],
        allowImpersonatingAdmins: false,
      }),
      twoFactor({ issuer: "Duis" }),
      phoneNumber({
        otpLength: 6,
        expiresIn: 5 * 60,
        allowedAttempts: 5,
        phoneNumberValidator: (value) => INDIAN_MOBILE.test(value),
        sendOTP: async ({ phoneNumber: to, code }) => {
          await deps.sendPhoneOtp({ phoneNumber: to, code })
        },
        signUpOnVerification: {
          // Placeholder until the customer adds a real address; `.invalid` is
          // a reserved TLD, so nothing can ever be delivered to it.
          getTempEmail: (value) =>
            `${value.replace(/\D/g, "")}@phone.duis.invalid`,
          getTempName: () => "Duis customer",
        },
      }),
      // Must stay last: lets Server Actions set auth cookies.
      nextCookies(),
    ],
  } satisfies BetterAuthOptions
}
