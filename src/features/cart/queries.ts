import "server-only"
import { cookies } from "next/headers"
import { cache } from "react"

import { getActor } from "@/server/auth/session"

import { CART_COOKIE } from "./cookie"
import { getCart } from "./service"

/**
 * The visitor's cart for this request (never cached across requests: it
 * reads the session and cart cookie). Deduplicated within one render.
 */
export const getCurrentCart = cache(async () => {
  const [actor, jar] = await Promise.all([getActor(), cookies()])
  const guestToken = jar.get(CART_COOKIE)?.value
  return getCart(actor, {
    guestToken: actor.kind === "user" ? undefined : guestToken,
  })
})
