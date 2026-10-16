"use server"

import { getActor } from "@/server/auth/session"
import { toActionError } from "@/server/action"
import { createRateLimiter } from "@/server/security/rate-limit"

import { subscribeStockAlert } from "./service"

// Per address: a handful of alerts a minute is plenty for a person.
const allow = createRateLimiter({ limit: 10, windowMs: 60_000 })

export type StockAlertState =
  | { status: "idle" }
  | { status: "done" | "in_stock" | "error"; message: string }

export async function subscribeStockAlertAction(
  _previous: StockAlertState,
  form: FormData,
): Promise<StockAlertState> {
  const actor = await getActor()
  const ip = actor.kind === "system" ? null : actor.ip
  if (!allow(ip ?? "unknown")) {
    return {
      status: "error",
      message: "Too many requests. Try again in a minute.",
    }
  }
  try {
    const result = await subscribeStockAlert(actor, {
      variantId: String(form.get("variantId") ?? ""),
      email: String(form.get("email") ?? ""),
    })
    return result.status === "in_stock"
      ? {
          status: "in_stock",
          message: "Good news: it's in stock now. Refresh to add it.",
        }
      : {
          status: "done",
          message: "Done. We'll email you once when it's back.",
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
