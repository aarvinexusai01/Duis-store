import type { Route } from "next"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import type { NextRequest } from "next/server"

import { CART_COOKIE, mergeGuestCart } from "@/features/cart"
import { safeNextPath } from "@/lib/safe-redirect"
import { getActor } from "@/server/auth/session"
import { logger } from "@/server/observability/logger"

/**
 * Every sign-in method ends here (phone OTP, email, Google, the email
 * verification link): the guest bag is merged into the account and the
 * customer continues to `next`. Merging is idempotent, so a repeated or
 * forged visit only ever merges the visitor's own bag into their own account.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const error = params.get("error")
  if (error) {
    redirect(`/verify-email?error=${encodeURIComponent(error.slice(0, 64))}`)
  }

  const next = safeNextPath(params.get("next"))
  const actor = await getActor()
  if (actor.kind !== "user") {
    redirect(`/login?next=${encodeURIComponent(next)}`)
  }

  const jar = await cookies()
  const guestToken = jar.get(CART_COOKIE)?.value
  if (guestToken) {
    try {
      await mergeGuestCart(actor, { guestToken })
    } catch (err) {
      // An unreadable cookie must not block sign-in; the bag stays as it was.
      logger.warn(
        { err, requestId: actor.requestId },
        "guest cart merge failed",
      )
    }
    jar.delete(CART_COOKIE)
  }
  redirect(next as Route)
}
