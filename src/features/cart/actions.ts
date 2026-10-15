"use server"

import { refresh } from "next/cache"
import { cookies } from "next/headers"

import { getServerEnv } from "@/config/env"
import { getActor } from "@/server/auth/session"
import { toActionError, type ActionError } from "@/server/action"

import { CART_COOKIE, cartCookieOptions } from "./cookie"
import { addCartItem, mergeGuestCart, updateCartItem } from "./service"

export type CartActionResult = { ok: true } | ({ ok: false } & ActionError)

/**
 * Signed-in customers who still carry a guest cookie (for example after
 * signing in elsewhere) get their guest cart merged before any change.
 */
async function context() {
  const actor = await getActor()
  const jar = await cookies()
  const token = jar.get(CART_COOKIE)?.value
  if (actor.kind === "user" && token) {
    await mergeGuestCart(actor, { guestToken: token }).catch(() => undefined)
    jar.delete(CART_COOKIE)
    return { actor, jar, guestToken: undefined }
  }
  return { actor, jar, guestToken: token }
}

export async function addToCart(input: {
  variantId: string
  quantity: number
}): Promise<CartActionResult> {
  try {
    const { actor, jar, guestToken } = await context()
    const result = await addCartItem(actor, { guestToken, ...input })
    if (result.newGuestToken) {
      jar.set(
        CART_COOKIE,
        result.newGuestToken,
        cartCookieOptions(getServerEnv().APP_URL.startsWith("https:")),
      )
    }
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}

export async function setCartQuantity(input: {
  variantId: string
  quantity: number
}): Promise<CartActionResult> {
  try {
    const { actor, guestToken } = await context()
    await updateCartItem(actor, { guestToken, ...input })
    refresh()
    return { ok: true }
  } catch (error) {
    return { ok: false, ...toActionError(error) }
  }
}
