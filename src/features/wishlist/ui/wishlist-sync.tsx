"use client"

import { useEffect } from "react"

import { syncWishlist } from "./store"

export function WishlistSyncClient({
  signedIn,
  ids,
}: {
  signedIn: boolean
  ids: string[]
}) {
  useEffect(() => syncWishlist(signedIn, ids), [signedIn, ids])
  return null
}
