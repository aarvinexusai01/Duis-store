import "server-only"

import { getServerEnv } from "@/config/env"
import { logger } from "@/server/observability/logger"

/**
 * Server-side Turnstile check for our own forms (Better Auth's plugin covers
 * its endpoints). True when Turnstile is off (no keys) or the token passes.
 */
export async function verifyTurnstile(
  token: string | null,
  ip: string | null,
): Promise<boolean> {
  const secret = getServerEnv().TURNSTILE_SECRET_KEY
  if (!secret) return true
  if (!token) return false
  const body = new URLSearchParams({ secret, response: token })
  if (ip) body.set("remoteip", ip)
  try {
    const response = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body, signal: AbortSignal.timeout(5_000) },
    )
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch (error) {
    // Fail closed: a form protected by Turnstile stays protected.
    logger.warn({ err: error }, "Turnstile verification failed")
    return false
  }
}
