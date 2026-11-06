import type { Page } from "@playwright/test"

/** Ticks a form's DPDP box (the footer's newsletter has its own). */
export async function tickConsent(page: Page, purpose: string) {
  await page.locator(`[data-consent="${purpose}"]:visible`).first().check()
}

/**
 * The account and age boxes, then straight on, as a quick customer would: the
 * form waits for the consent cookie itself before it calls Better Auth.
 */
export async function tickAccountConsent(page: Page) {
  await page.waitForLoadState("networkidle")
  await tickConsent(page, "account")
  await tickConsent(page, "age")
}

/**
 * Every E2E browser starts with cookies already answered ("Reject all"), so
 * the consent banner never covers what a test clicks. The consent spec
 * starts without it.
 */
export function answeredConsent(baseURL: string) {
  return {
    cookies: [
      {
        name: "duis_consent",
        value: "1.00.0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b",
        domain: new URL(baseURL).hostname,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: false,
        sameSite: "Lax" as const,
      },
    ],
    origins: [],
  }
}
