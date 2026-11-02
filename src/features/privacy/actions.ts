"use server"

import type { Route } from "next"
import { refresh } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"

import { getServerEnv } from "@/config/env"
import {
  ACCOUNT_CONSENT_COOKIE,
  consentFromForm,
  NOTICE_LANGUAGES,
  NOTICE_VERSION,
  type NoticeLanguage,
} from "@/lib/privacy"
import { safeNextPath } from "@/lib/safe-redirect"
import { toActionError, type ActionError } from "@/server/action"
import { getActor } from "@/server/auth/session"

import {
  acceptAccountNotice,
  eraseCustomer,
  setNominee,
  withdrawConsent,
} from "./service"

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

export type AccountNoticeState = { message: string | null }

/** The one-time prompt for customers who haven't seen this notice version. */
export async function acceptAccountNoticeAction(
  _previous: AccountNoticeState,
  form: FormData,
): Promise<AccountNoticeState> {
  try {
    await acceptAccountNotice(await getActor(), consentFromForm(form))
  } catch (error) {
    const { code, message } = toActionError(error)
    return {
      message:
        code === "VALIDATION_FAILED"
          ? "Please tick both boxes to continue."
          : message,
    }
  }
  redirect(safeNextPath(String(form.get("next") ?? "")) as Route)
}

type Result = { ok: true } | ({ ok: false } & ActionError)

async function run(work: () => Promise<unknown>): Promise<Result> {
  try {
    await work()
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

export async function withdrawConsentAction(
  purpose: Parameters<typeof withdrawConsent>[1]["purpose"],
) {
  return run(async () => withdrawConsent(await getActor(), { purpose }))
}

export async function setNomineeAction(
  input: Parameters<typeof setNominee>[1],
) {
  return run(async () => setNominee(await getActor(), input))
}

export async function eraseCustomerAction(userId: string) {
  return run(async () => eraseCustomer(await getActor(), { userId }))
}
