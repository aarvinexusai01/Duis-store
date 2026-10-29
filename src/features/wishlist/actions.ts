"use server"

import { refresh } from "next/cache"

import { getActor } from "@/server/auth/session"
import { toActionError } from "@/server/action"

import { addWishlistItem, removeWishlistItem } from "./service"

export type WishlistActionResult =
  | { status: "saved" | "removed" }
  | { status: "signin" }
  | { status: "error"; message: string }

export async function setWishlisted(
  productId: string,
  saved: boolean,
): Promise<WishlistActionResult> {
  const actor = await getActor()
  if (actor.kind !== "user") return { status: "signin" }
  try {
    if (saved) await addWishlistItem(actor, { productId })
    else await removeWishlistItem(actor, { productId })
    // Pages remembered in the browser (staleTimes) show the new state.
    refresh()
    return { status: saved ? "saved" : "removed" }
  } catch (error) {
    return { status: "error", message: toActionError(error).message }
  }
}
