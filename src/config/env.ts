import "server-only"
import { z } from "zod"

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ })

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
    APP_URL: z.url({ protocol: /^https?$/ }),
    LOG_LEVEL: z
      .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
      .default("info"),

    DATABASE_URL: postgresUrl,
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(10),

    // Email is wired in Phase 1; until then SMTP is optional, but it must be
    // complete if any of it is set.
    SMTP_HOST: z.string().min(1).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).optional(),
    SMTP_SECURE: z.stringbool().default(false),
    SMTP_USER: z.string().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    SMTP_FROM: z.string().min(3).optional(),
  })
  .superRefine((env, ctx) => {
    const smtp = [env.SMTP_HOST, env.SMTP_PORT, env.SMTP_FROM]
    if (smtp.some(Boolean) && !smtp.every(Boolean)) {
      ctx.addIssue({
        code: "custom",
        path: ["SMTP_HOST"],
        message: "SMTP_HOST, SMTP_PORT and SMTP_FROM must be set together",
      })
    }
    if (env.APP_ENV === "production" && !env.APP_URL.startsWith("https://")) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message: "APP_URL must use https in production",
      })
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
