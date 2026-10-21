import "server-only"
import { z } from "zod"

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ })
const httpUrl = z.url({ protocol: /^https?$/ })

const urlList = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  )
  .pipe(z.array(httpUrl).min(1))

/**
 * Runtime configuration for the web and worker processes.
 *
 * Parsed lazily (not at import time) so `next build` never needs secrets;
 * instrumentation.ts calls getServerEnv() at startup to fail fast instead.
 * Migration credentials are deliberately absent: only the migrate step
 * receives MIGRATION_DATABASE_URL.
 */
export const serverEnvSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_ENV: z
      .enum(["development", "test", "staging", "production"])
      .default("development"),
    APP_URL: httpUrl,
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

    BETTER_AUTH_SECRET: z.string().min(32),
    GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),

    SMTP_HOST: z.string().min(1),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(3),

    // "fake" records messages in memory and the log; real providers arrive
    // with DLT registration (doc/10 A2).
    SMS_PROVIDER: z.enum(["fake", "msg91"]).default("fake"),
    // MSG91 (owner decision 2026-10-16): auth key and the DLT-approved OTP
    // template. Unverified until the account exists (doc/10 A2).
    SMS_API_KEY: z.string().min(10).optional(),
    SMS_OTP_TEMPLATE_ID: z.string().min(5).optional(),
    // WhatsApp order and exchange updates: "off" sends none, "fake" logs them.
    WHATSAPP_PROVIDER: z.enum(["off", "fake", "msg91"]).default("fake"),
    WHATSAPP_API_KEY: z.string().min(10).optional(),
    // The business number registered with MSG91, and the template namespace.
    WHATSAPP_NUMBER: z
      .string()
      .regex(/^\d{10,15}$/)
      .optional(),
    WHATSAPP_TEMPLATE_NAMESPACE: z.string().min(5).optional(),
    // Sent by MSG91 on inbound-message webhooks (STOP handling).
    WHATSAPP_WEBHOOK_TOKEN: z.string().min(16).optional(),
    // Cloudflare Turnstile on login codes, sign-up and password reset; off
    // until both are set (doc/10 A10).
    TURNSTILE_SITE_KEY: z.string().min(10).optional(),
    TURNSTILE_SECRET_KEY: z.string().min(10).optional(),
    // Analytics (ADR-0027): read per request, so one image serves every
    // environment. Each is off while unset, and loads only after consent.
    GA4_MEASUREMENT_ID: z
      .string()
      .regex(/^G-[A-Z0-9]{4,20}$/)
      .optional(),
    META_PIXEL_ID: z
      .string()
      .regex(/^\d{10,20}$/)
      .optional(),
    // Server-side Purchase events (Conversions API); needs META_PIXEL_ID.
    META_CAPI_ACCESS_TOKEN: z.string().min(20).optional(),
    // Routes Conversions API events to Events Manager → Test events.
    META_CAPI_TEST_EVENT_CODE: z.string().min(3).max(40).optional(),
    // Courier rates, shipments and tracking (doc/03 §6). "fake" answers from
    // fixed rules for development; "shiprocket" uses the account below and is
    // unverified until one real test shipment (doc/10 A5).
    SHIPPING_PROVIDER: z.enum(["fake", "shiprocket"]).default("fake"),
    SHIPROCKET_API_EMAIL: z.email().optional(),
    SHIPROCKET_API_PASSWORD: z.string().min(1).optional(),
    // Sent by Shiprocket in the x-api-key header of tracking webhooks.
    SHIPROCKET_WEBHOOK_TOKEN: z.string().min(16).optional(),
    // The pickup address's nickname in the Shiprocket panel, and its PIN code.
    SHIPROCKET_PICKUP_LOCATION: z.string().min(1).optional(),
    SHIPROCKET_PICKUP_PINCODE: z
      .string()
      .regex(/^[1-9][0-9]{5}$/)
      .optional(),
    // "fake" simulates payments for development and tests; "razorpay" uses
    // the keys below (test keys until launch). Never committed.
    PAYMENT_PROVIDER: z.enum(["fake", "razorpay"]).default("fake"),
    RAZORPAY_KEY_ID: z
      .string()
      .regex(/^rzp_(test|live)_\w+$/)
      .optional(),
    RAZORPAY_KEY_SECRET: z.string().min(10).optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(10).optional(),

    MEDIA_ROOT: z.string().min(1).default("./storage/media"),
    // Files that are never public, such as shipping labels.
    STORAGE_PRIVATE_ROOT: z.string().min(1).default("./storage/private"),
    MEDIA_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(15 * 1024 * 1024),

    // Server health alerts (doc/07 §7): who gets them. Unset: shown on the
    // System page only.
    OPS_ALERT_EMAIL: z
      .string()
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.email()).min(1))
      .optional(),
    // Error reports to Sentry (doc/10: Sentry SaaS); off while unset.
    SENTRY_DSN: httpUrl.optional(),
    SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),

    // Cache invalidation fan-out to every web replica (ADR-008, ADR-017).
    INTERNAL_REVALIDATE_SECRET: z.string().min(32),
    INTERNAL_REVALIDATE_URLS: urlList,
  })
  .superRefine((env, ctx) => {
    if (Boolean(env.GOOGLE_CLIENT_ID) !== Boolean(env.GOOGLE_CLIENT_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_ID"],
        message:
          "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set together",
      })
    }
    if (
      env.PAYMENT_PROVIDER === "razorpay" &&
      !(
        env.RAZORPAY_KEY_ID &&
        env.RAZORPAY_KEY_SECRET &&
        env.RAZORPAY_WEBHOOK_SECRET
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["PAYMENT_PROVIDER"],
        message:
          "PAYMENT_PROVIDER=razorpay needs RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET and RAZORPAY_WEBHOOK_SECRET",
      })
    }
    if (
      env.SMS_PROVIDER === "msg91" &&
      !(env.SMS_API_KEY && env.SMS_OTP_TEMPLATE_ID)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SMS_PROVIDER"],
        message: "SMS_PROVIDER=msg91 needs SMS_API_KEY and SMS_OTP_TEMPLATE_ID",
      })
    }
    if (
      env.WHATSAPP_PROVIDER === "msg91" &&
      !(
        env.WHATSAPP_API_KEY &&
        env.WHATSAPP_NUMBER &&
        env.WHATSAPP_TEMPLATE_NAMESPACE &&
        env.WHATSAPP_WEBHOOK_TOKEN
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["WHATSAPP_PROVIDER"],
        message:
          "WHATSAPP_PROVIDER=msg91 needs WHATSAPP_API_KEY, WHATSAPP_NUMBER, WHATSAPP_TEMPLATE_NAMESPACE and WHATSAPP_WEBHOOK_TOKEN",
      })
    }
    if (Boolean(env.TURNSTILE_SITE_KEY) !== Boolean(env.TURNSTILE_SECRET_KEY)) {
      ctx.addIssue({
        code: "custom",
        path: ["TURNSTILE_SITE_KEY"],
        message:
          "TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY must be set together",
      })
    }
    if (env.META_CAPI_ACCESS_TOKEN && !env.META_PIXEL_ID) {
      ctx.addIssue({
        code: "custom",
        path: ["META_CAPI_ACCESS_TOKEN"],
        message: "META_CAPI_ACCESS_TOKEN needs META_PIXEL_ID",
      })
    }
    if (
      env.SHIPPING_PROVIDER === "shiprocket" &&
      !(
        env.SHIPROCKET_API_EMAIL &&
        env.SHIPROCKET_API_PASSWORD &&
        env.SHIPROCKET_WEBHOOK_TOKEN &&
        env.SHIPROCKET_PICKUP_LOCATION &&
        env.SHIPROCKET_PICKUP_PINCODE
      )
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["SHIPPING_PROVIDER"],
        message:
          "SHIPPING_PROVIDER=shiprocket needs SHIPROCKET_API_EMAIL, SHIPROCKET_API_PASSWORD, SHIPROCKET_WEBHOOK_TOKEN, SHIPROCKET_PICKUP_LOCATION and SHIPROCKET_PICKUP_PINCODE",
      })
    }
    if (env.APP_ENV === "production") {
      if (env.PAYMENT_PROVIDER !== "razorpay") {
        ctx.addIssue({
          code: "custom",
          path: ["PAYMENT_PROVIDER"],
          message: "PAYMENT_PROVIDER must be razorpay in production",
        })
      }
      if (!env.APP_URL.startsWith("https://")) {
        ctx.addIssue({
          code: "custom",
          path: ["APP_URL"],
          message: "APP_URL must use https in production",
        })
      }
      if (env.SMS_PROVIDER === "fake") {
        ctx.addIssue({
          code: "custom",
          path: ["SMS_PROVIDER"],
          message: "SMS_PROVIDER cannot be fake in production",
        })
      }
      if (env.WHATSAPP_PROVIDER === "fake") {
        ctx.addIssue({
          code: "custom",
          path: ["WHATSAPP_PROVIDER"],
          message:
            "WHATSAPP_PROVIDER cannot be fake in production (use off or msg91)",
        })
      }
      if (env.SHIPPING_PROVIDER === "fake") {
        ctx.addIssue({
          code: "custom",
          path: ["SHIPPING_PROVIDER"],
          message:
            "SHIPPING_PROVIDER cannot be fake in production (it invents delivery estimates)",
        })
      }
      // The standalone server changes directory on start (scripts/start-standalone.mjs).
      if (!env.MEDIA_ROOT.startsWith("/")) {
        ctx.addIssue({
          code: "custom",
          path: ["MEDIA_ROOT"],
          message: "MEDIA_ROOT must be an absolute path in production",
        })
      }
      if (!env.STORAGE_PRIVATE_ROOT.startsWith("/")) {
        ctx.addIssue({
          code: "custom",
          path: ["STORAGE_PRIVATE_ROOT"],
          message:
            "STORAGE_PRIVATE_ROOT must be an absolute path in production",
        })
      }
    }
  })

export type ServerEnv = z.infer<typeof serverEnvSchema>

export function parseServerEnv(
  source: Record<string, string | undefined>,
): ServerEnv {
  const result = serverEnvSchema.safeParse(source)
  if (!result.success) {
    // Never echo values: they may contain credentials.
    throw new Error(
      `Invalid environment configuration:\n${z.prettifyError(result.error)}`,
    )
  }
  return result.data
}

let cached: ServerEnv | undefined

export function getServerEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env)
  return cached
}
