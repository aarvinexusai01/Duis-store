import { createHmac, timingSafeEqual } from "node:crypto"

/**
 * Signed internal requests (cache revalidation fan-out). The signature covers
 * a timestamp and the exact body, and expires after five minutes so a
 * captured request cannot be replayed later.
 */
const MAX_AGE_MS = 5 * 60 * 1000

export const SIGNATURE_HEADER = "x-duis-signature"
export const TIMESTAMP_HEADER = "x-duis-timestamp"

function digest(secret: string, timestamp: string, body: string): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
}

export function signPayload(
  secret: string,
  body: string,
  now: number = Date.now(),
): { timestamp: string; signature: string } {
  const timestamp = String(now)
  return { timestamp, signature: digest(secret, timestamp, body) }
}

export function verifyPayload(
  secret: string,
  body: string,
  timestamp: string | null,
  signature: string | null,
  now: number = Date.now(),
): boolean {
  if (!timestamp || !signature || !/^\d{10,16}$/.test(timestamp)) return false
  if (Math.abs(now - Number(timestamp)) > MAX_AGE_MS) return false

  const expected = Buffer.from(digest(secret, timestamp, body), "hex")
  const received = Buffer.from(signature, "hex")
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  )
}
