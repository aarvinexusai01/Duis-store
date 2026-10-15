import "server-only"
import { createHash, randomBytes } from "node:crypto"

/**
 * Bearer tokens for links and cookies (cart, newsletter confirmation). Only
 * the SHA-256 is stored, so a database leak does not reveal usable tokens.
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url")
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex")
}

/** Shape of a token from newToken(); anything else is rejected unhashed. */
export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/
