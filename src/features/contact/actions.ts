"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"
import { createRateLimiter } from "@/server/security/rate-limit"
import { verifyTurnstile } from "@/server/security/turnstile"

import { updateContactMessage } from "./admin"
import { sendContactMessage } from "./service"

// Per IP: a few messages in ten minutes is plenty for a person.
const allow = createRateLimiter({ limit: 5, windowMs: 10 * 60_000 })

export type ContactFormState =
  | { status: "idle" }
  | { status: "sent" }
  | {
      status: "error"
      message: string
      fields?: Partial<Record<string, string>>
    }

export async function sendContactMessageAction(
  _previous: ContactFormState,
  form: FormData,
): Promise<ContactFormState> {
  // A hidden field people never see: bots that fill it get a quiet "sent".
  if (String(form.get("website") ?? "") !== "") return { status: "sent" }
  const actor = await getActor()
  const ip = actor.kind === "system" ? null : actor.ip
  if (!allow(ip ?? "unknown")) {
    return {
      status: "error",
      message: "Too many messages. Try again in a few minutes.",
    }
  }
  const token = form.get("turnstile")
  if (!(await verifyTurnstile(typeof token === "string" ? token : null, ip))) {
    return {
      status: "error",
      message: "We couldn't check you're not a robot. Try again.",
    }
  }
  try {
    await sendContactMessage(actor, {
      name: String(form.get("name") ?? ""),
      email: String(form.get("email") ?? ""),
      phone: String(form.get("phone") ?? ""),
      orderNumber: String(form.get("orderNumber") ?? ""),
      topic: String(form.get("topic") ?? "") as "other",
      message: String(form.get("message") ?? ""),
    })
    return { status: "sent" }
  } catch (error) {
    const mapped = toActionError(error)
    return {
      status: "error",
      message:
        mapped.code === "VALIDATION_FAILED"
          ? "Check the highlighted fields."
          : mapped.message,
      ...(mapped.fieldErrors
        ? {
            fields: Object.fromEntries(
              Object.entries(mapped.fieldErrors).map(([k, v]) => [k, v?.[0]]),
            ),
          }
        : {}),
    }
  }
}

type Result = { ok: true } | ({ ok: false } & ActionError)

export async function updateContactMessageAction(
  input: Parameters<typeof updateContactMessage>[1],
): Promise<Result> {
  try {
    await updateContactMessage(await getActor(), input)
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}
