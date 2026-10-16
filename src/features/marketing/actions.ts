"use server"

import { getActor } from "@/server/auth/session"
import { toActionError } from "@/server/action"

import { unsubscribeMarketing } from "./cart-reminders"
import { confirmNewsletter, subscribeNewsletter } from "./service"

export type NewsletterState =
  | { status: "idle" }
  | { status: "done"; message: string }
  | { status: "error"; message: string }

export async function subscribeToNewsletter(
  _previous: NewsletterState,
  form: FormData,
): Promise<NewsletterState> {
  try {
    await subscribeNewsletter(await getActor(), {
      email: String(form.get("email") ?? ""),
      source: form.get("source") === "home" ? "home" : "footer",
    })
    return {
      status: "done",
      message: "Almost there — check your inbox to confirm.",
    }
  } catch (error) {
    const { code, message } = toActionError(error)
    return {
      status: "error",
      message:
        code === "VALIDATION_FAILED" ? "Enter a valid email address." : message,
    }
  }
}

export type ConfirmState = { status: "idle" | "confirmed" | "invalid" }

export async function confirmNewsletterSubscription(
  _previous: ConfirmState,
  form: FormData,
): Promise<ConfirmState> {
  try {
    const result = await confirmNewsletter(await getActor(), {
      token: String(form.get("token") ?? ""),
    })
    return { status: result }
  } catch (error) {
    toActionError(error)
    return { status: "invalid" }
  }
}

export type UnsubscribeState = { status: "idle" | "done" | "invalid" }

/** The confirm button on /unsubscribe (a click, so mail scanners can't trigger it). */
export async function unsubscribeMarketingAction(
  _previous: UnsubscribeState,
  form: FormData,
): Promise<UnsubscribeState> {
  const result = await unsubscribeMarketing(await getActor(), {
    userId: String(form.get("u") ?? ""),
    token: String(form.get("t") ?? ""),
  }).catch(() => ({ done: false }))
  return { status: result.done ? "done" : "invalid" }
}
