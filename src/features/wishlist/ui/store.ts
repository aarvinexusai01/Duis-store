"use client"

import { useSyncExternalStore } from "react"

/**
 * The visitor's saved product ids, shared by every heart on the page. Pages
 * stay cacheable: the ids arrive from a small request-time island
 * (WishlistSync) instead of being rendered into each card.
 */
type State = { known: boolean; signedIn: boolean; ids: ReadonlySet<string> }

const INITIAL: State = { known: false, signedIn: false, ids: new Set() }
let state = INITIAL
const listeners = new Set<() => void>()

function emit(next: State) {
  state = next
  listeners.forEach((listener) => listener())
}

export function syncWishlist(signedIn: boolean, ids: string[]) {
  emit({ known: true, signedIn, ids: new Set(ids) })
}

export function markWishlisted(productId: string, saved: boolean) {
  const ids = new Set(state.ids)
  if (saved) ids.add(productId)
  else ids.delete(productId)
  emit({ ...state, ids })
}

export function useWishlistState(): State {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => state,
    () => INITIAL,
  )
}
