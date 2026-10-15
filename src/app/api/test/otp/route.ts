import { notFound } from "next/navigation"
import { connection, type NextRequest } from "next/server"

import { getServerEnv } from "@/config/env"
import { lastFakeOtp } from "@/server/notifications/sms"

/**
 * End-to-end tests read the last OTP the fake SMS provider "sent". It exists
 * only when APP_ENV=test and SMS_PROVIDER=fake; anywhere else it is a 404,
 * and production cannot run the fake provider at all (config/env.ts).
 */
export async function GET(request: NextRequest) {
  // Request-time only: otherwise the build would prerender (and cache) the
  // answer for the build's environment.
  await connection()
  const env = getServerEnv()
  if (env.APP_ENV !== "test" || env.SMS_PROVIDER !== "fake") notFound()
  const phone = request.nextUrl.searchParams.get("phone") ?? ""
  const code = lastFakeOtp(phone)
  return code
    ? Response.json({ code }, { headers: { "Cache-Control": "no-store" } })
    : Response.json({ error: "no code" }, { status: 404 })
}
