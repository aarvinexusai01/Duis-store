import "server-only"

import { ACCOUNT_CONSENT_COOKIE, parseAccountConsent } from "@/lib/privacy"
import { getDb } from "@/server/db/client"
import { hasCurrentConsent, recordConsents } from "@/server/privacy"

/**
 * Account consent for Better Auth (doc/06 Phase 12). The sign-up and sign-in
 * forms set ACCOUNT_CONSENT_COOKIE when the account and "18 or older" boxes
 * are ticked; Better Auth refuses to take personal data without it, and
 * records the consent once the account is known.
 */

function cookieValue(headers: Headers, name: string): string | null {
  for (const part of (headers.get("cookie") ?? "").split(";")) {
    const [key, ...value] = part.trim().split("=")
    if (key === name) return decodeURIComponent(value.join("="))
  }
  return null
}

export const accountConsent = {
  hasAccountConsent(headers: Headers): boolean {
    return (
      parseAccountConsent(cookieValue(headers, ACCOUNT_CONSENT_COOKIE)) !== null
    )
  },

  /** Once per user and notice version; nothing without the ticked cookie. */
  async recordAccountConsent(
    userId: string,
    headers: Headers,
    source: string,
  ): Promise<void> {
    const ticked = parseAccountConsent(
      cookieValue(headers, ACCOUNT_CONSENT_COOKIE),
    )
    if (!ticked) return
    const db = getDb()
    if (await hasCurrentConsent(db, userId, "account")) return
    await recordConsents(db, {
      userId,
      purposes: ["account", "age"],
      source,
      language: ticked.language,
      userAgent: headers.get("user-agent"),
    })
  },
}
