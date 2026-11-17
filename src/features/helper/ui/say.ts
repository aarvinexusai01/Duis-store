import type { Mood } from "./mascot"

/**
 * Lets any admin page make the helper say something, without importing it:
 * a short message in a speech bubble above the cat, with optional buttons.
 * Ignored while the helper is hidden or showing a tour.
 */
export type Saying = {
  /** One message per id: a newer one with the same id replaces it. */
  id: string
  text: string
  mood?: Mood
  /** Scrolled into view and outlined while the bubble shows. */
  target?: string
  actions?: { label: string; run?: () => void }[]
  /** Closed without choosing an action (the × button, or Escape). */
  onDismiss?: () => void
}

const EVENT = "duis:helper-say"

export function helperSay(saying: Saying): void {
  window.dispatchEvent(new CustomEvent<Saying>(EVENT, { detail: saying }))
}

export function onHelperSay(listener: (saying: Saying) => void): () => void {
  const handle = (event: Event) =>
    listener((event as CustomEvent<Saying>).detail)
  window.addEventListener(EVENT, handle)
  return () => window.removeEventListener(EVENT, handle)
}
