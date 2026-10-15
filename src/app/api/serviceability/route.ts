import type { NextRequest } from "next/server"

import { checkServiceability } from "@/features/shipping"
import { getActor } from "@/server/auth/session"
import { errorResponse } from "@/server/http"
import { createRateLimiter } from "@/server/security/rate-limit"

const allow = createRateLimiter({ limit: 20, windowMs: 60_000 })

/** PIN-code delivery check for the product page (GET ?pincode=560001). */
export async function GET(request: NextRequest) {
  const actor = await getActor()
  const ip = request.headers.get("x-real-ip") ?? "unknown"
  if (!allow(ip)) {
    return Response.json(
      {
        error: {
          code: "RATE_LIMITED",
          message: "Too many checks. Try again in a minute.",
        },
      },
      { status: 429, headers: { "Retry-After": "60" } },
    )
  }
  try {
    const result = await checkServiceability(actor, {
      pincode: request.nextUrl.searchParams.get("pincode") ?? "",
    })
    return Response.json(result, {
      headers: { "Cache-Control": "private, max-age=300" },
    })
  } catch (error) {
    return errorResponse(error, actor.requestId)
  }
}
