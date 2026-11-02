"use server"

import { cookies } from "next/headers"

import { getServerEnv } from "@/config/env"
import {
  ACCOUNT_CONSENT_COOKIE,
  NOTICE_LANGUAGES,
  NOTICE_VERSION,
  type NoticeLanguage,
} from "@/lib/privacy"

/**
 * Sets the account-consent cookie while the sign-up or sign-in boxes are
 * ticked (and clears it when they aren't). Better Auth refuses to take a
 * phone number, email or Google profile without it, and records the
 * consent when the account is created (src/server/auth/consent.ts).
 */
export async function setAccountConsentAction(
  language: NoticeLanguage | null,
): Promise<void> {
  const jar = await cookies()
  if (!language || !NOTICE_LANGUAGES.includes(language)) {
    jar.delete(ACCOUNT_CONSENT_COOKIE)
    return
  }
  jar.set(ACCOUNT_CONSENT_COOKIE, `${NOTICE_VERSION}.${language}`, {
    httpOnly: true,
    sameSite: "lax",
    secure: getServerEnv().APP_URL.startsWith("https://"),
    path: "/",
    // Long enough to receive and type a code, or to come back from Google.
    maxAge: 30 * 60,
  })
}
