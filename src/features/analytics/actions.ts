"use server"

import { cookies, headers } from "next/headers"

import { getServerEnv } from "@/config/env"
import { getActor } from "@/server/auth/session"
import { toActionError } from "@/server/action"
import { createRateLimiter } from "@/server/security/rate-limit"

import {
  CONSENT_COOKIE,
  CONSENT_MAX_AGE_SECONDS,
  consentChoiceSchema,
  formatConsent,
  parseConsent,
} from "./consent"
import { recordConsent } from "./service"

const allow = createRateLimiter({ limit: 30, windowMs: 60_000 })

export type SaveConsentResult = { ok: true } | { ok: false; message: string }

/**
 * Records the banner answer and sets the consent cookie. The same visitor
 * keeps the same random ID across changes, so the records form a history.
 */
export async function saveCookieConsentAction(input: {
  analytics: boolean
  marketing: boolean
  source: "banner" | "settings"
}): Promise<SaveConsentResult> {
  try {
    const choice = consentChoiceSchema.parse(input)
    const actor = await getActor()
    const ip = actor.kind === "system" ? null : actor.ip
    if (!allow(ip ?? "unknown")) {
      return { ok: false, message: "Too many changes. Try again in a minute." }
    }
    const jar = await cookies()
    const visitorId =
      parseConsent(jar.get(CONSENT_COOKIE)?.value)?.visitorId ??
      // An older-version cookie still names the same visitor.
      /\.([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(
        jar.get(CONSENT_COOKIE)?.value ?? "",
      )?.[1] ??
      crypto.randomUUID()
    const userAgent = (await headers()).get("user-agent")
    await recordConsent(actor, {
      visitorId,
      analytics: choice.analytics,
      marketing: choice.marketing,
      source: choice.source,
      ...(userAgent ? { userAgent: userAgent.slice(0, 500) } : {}),
    })
    jar.set(
      CONSENT_COOKIE,
      formatConsent({
        visitorId,
        analytics: choice.analytics,
        marketing: choice.marketing,
      }),
      {
        path: "/",
        maxAge: CONSENT_MAX_AGE_SECONDS,
        sameSite: "lax",
        secure: getServerEnv().APP_URL.startsWith("https:"),
        httpOnly: false,
      },
    )
    return { ok: true }
  } catch (error) {
    return { ok: false, message: toActionError(error).message }
  }
}
