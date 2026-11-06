import { createHmac } from "node:crypto"

import type { APIRequestContext } from "@playwright/test"

/**
 * Drops the app's cached data for these tags, as a staff change would, for
 * tests that write settings straight to the database.
 */
export async function revalidateTags(
  request: APIRequestContext,
  tags: string[],
): Promise<void> {
  const body = JSON.stringify({ tags })
  const timestamp = String(Date.now())
  const signature = createHmac(
    "sha256",
    process.env.INTERNAL_REVALIDATE_SECRET!,
  )
    .update(`${timestamp}.${body}`)
    .digest("hex")
  const response = await request.post("/api/internal/revalidate", {
    data: body,
    headers: {
      "content-type": "application/json",
      "x-duis-timestamp": timestamp,
      "x-duis-signature": signature,
    },
  })
  if (!response.ok()) {
    throw new Error(`revalidate failed: ${response.status()}`)
  }
}
