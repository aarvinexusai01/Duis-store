import { useSyncExternalStore } from "react"

import { CONSENT_COOKIE, parseConsent, type StoredConsent } from "../consent"

/**
 * The visitor's cookie answer, read from the consent cookie, plus whether
 * the banner was reopened from "Cookie settings". `undefined` while
 * rendering on the server (unknown), `null` when they haven't answered.
 */

const listeners = new Set<() => void>()
let lastRaw: string | undefined
let lastParsed: StoredConsent | null = null
let settingsOpen = false

function rawCookie(): string | undefined {
  const prefix = `${CONSENT_COOKIE}=`
  return document.cookie
    .split("; ")
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length)
}

function snapshot(): StoredConsent | null {
  const raw = rawCookie()
  if (raw !== lastRaw) {
    lastRaw = raw
    lastParsed = parseConsent(raw ? decodeURIComponent(raw) : undefined)
  }
  return lastParsed
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function emit() {
  for (const listener of listeners) listener()
}

/** After the server action set the cookie. */
export function consentChanged() {
  emit()
}

export function useConsent(): StoredConsent | null | undefined {
  return useSyncExternalStore(subscribe, snapshot, () => undefined)
}

export function openCookieSettings() {
  settingsOpen = true
  emit()
}

export function closeCookieSettings() {
  settingsOpen = false
  emit()
}

export function useCookieSettingsOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => settingsOpen,
    () => false,
  )
}
