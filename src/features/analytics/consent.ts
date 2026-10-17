import { z } from "zod"

/**
 * The cookie consent record kept in the browser (ADR-0027), shared by the
 * server and the banner. Value: `<version>.<analytics><marketing>.<visitor>`,
 * e.g. `1.10.0190…`. Not httpOnly: the page reads it to decide what loads.
 */
export const CONSENT_COOKIE = "duis_consent"

/** Bump when the categories change: everyone is asked again. */
export const CONSENT_VERSION = 1

/** Asked again after 12 months. */
export const CONSENT_MAX_AGE_SECONDS = 365 * 24 * 60 * 60

export type ConsentChoice = { analytics: boolean; marketing: boolean }
export type StoredConsent = ConsentChoice & { visitorId: string }

const VALUE =
  /^(\d+)\.([01])([01])\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/

/** Null when missing, malformed or from an older banner version. */
export function parseConsent(
  value: string | null | undefined,
): StoredConsent | null {
  const match = value ? VALUE.exec(value) : null
  if (!match || Number(match[1]) !== CONSENT_VERSION) return null
  return {
    analytics: match[2] === "1",
    marketing: match[3] === "1",
    visitorId: match[4]!,
  }
}

export function formatConsent(consent: StoredConsent): string {
  return `${CONSENT_VERSION}.${consent.analytics ? 1 : 0}${consent.marketing ? 1 : 0}.${consent.visitorId}`
}

export const consentChoiceSchema = z.object({
  analytics: z.boolean(),
  marketing: z.boolean(),
  source: z.enum(["banner", "settings"]),
})
