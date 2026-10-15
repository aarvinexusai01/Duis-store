"use client"

import { useSyncExternalStore } from "react"

// Lets the product page open the header's cart drawer after "Add to bag".
let open = false
const listeners = new Set<() => void>()

export function setCartDrawerOpen(next: boolean) {
  open = next
  listeners.forEach((listener) => listener())
}

export function useCartDrawerOpen(): boolean {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => open,
    () => false,
  )
}
