import "server-only"
import pino from "pino"

/**
 * Structured JSON logs to stdout; Docker's json-file driver rotates them.
 * Reads LOG_LEVEL directly rather than through getServerEnv() so that the
 * logger stays usable while reporting an invalid configuration.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: process.env.SERVICE_NAME ?? "web" },
  timestamp: pino.stdTimeFunctions.isoTime,
  formatters: {
    level: (label) => ({ level: label }),
  },
  redact: {
    paths: [
      "password",
      "*.password",
      "token",
      "*.token",
      "otp",
      "*.otp",
      "secret",
      "*.secret",
      "authorization",
      "*.authorization",
      "headers.cookie",
      "req.headers.cookie",
      "req.headers.authorization",
    ],
    censor: "[redacted]",
  },
})

export type Logger = typeof logger
