"use server"

import { getActor } from "@/server/auth/session"
import { toActionError } from "@/server/action"

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
