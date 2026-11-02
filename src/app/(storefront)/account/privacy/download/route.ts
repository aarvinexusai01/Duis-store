import { connection } from "next/server"

import { exportMyData } from "@/features/privacy/operations"
import { getActor } from "@/server/auth/session"
import { isDomainError } from "@/server/errors"
import { createRateLimiter } from "@/server/security/rate-limit"

// A copy of the data is rarely needed twice in an hour.
const allow = createRateLimiter({ limit: 5, windowMs: 60 * 60_000 })

/** The signed-in customer's own data as a JSON file (DPDP Act s.11). */
export async function GET() {
  await connection()
  const actor = await getActor()
  if (actor.kind === "user" && !allow(actor.userId)) {
    return new Response("Too many downloads. Try again in an hour.", {
      status: 429,
    })
  }
  try {
    const data = await exportMyData(actor, {})
    return new Response(JSON.stringify(data, null, 2), {
      headers: {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": 'attachment; filename="duis-my-data.json"',
        "cache-control": "private, no-store",
      },
    })
  } catch (error) {
    if (isDomainError(error)) return new Response(null, { status: 404 })
    throw error
  }
}
