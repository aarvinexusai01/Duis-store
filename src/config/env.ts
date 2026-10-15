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
    SMS_PROVIDER: z.enum(["fake"]).default("fake"),
    // Courier serviceability and rates. "fake" answers from fixed rules for
    // development; Shiprocket arrives in Phase 3 (doc/03 §6).
    SHIPPING_PROVIDER: z.enum(["fake"]).default("fake"),

    MEDIA_ROOT: z.string().min(1).default("./storage/media"),
    MEDIA_MAX_UPLOAD_BYTES: z.coerce
      .number()
      .int()
      .min(1)
      .default(15 * 1024 * 1024),

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
    if (env.APP_ENV === "production") {
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
