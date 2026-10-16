import "server-only"
import { createHash } from "node:crypto"

import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"

/**
 * Login-code abuse limits (doc/06 Phase 5 §4, owner decision 2026-10-16):
 * per phone a 30-second cooldown, 5 an hour and 10 a day; per IP 20 an hour.
 * SMS pumping costs money per message, so these hold even when Better Auth's
 * per-IP limiter is off (tests). Only a hash of the number is kept, for a day.
 */
export const OTP_LIMITS = {
  cooldownSeconds: 30,
  perPhoneHour: 5,
  perPhoneDay: 10,
  perIpHour: 20,
} as const

const hashPhone = (phone: string) =>
  createHash("sha256").update(`otp:${phone}`).digest("hex")

/** Null when the request may go ahead (and is recorded), else the reason. */
export async function guardOtpRequest(
  phone: string,
  ip: string | null,
): Promise<string | null> {
  const db = getDb()
  const phoneHash = hashPhone(phone)
  const counts = await db.execute<{
    recent: number
    hour: number
    day: number
    ip_hour: number
  }>(sql`
    select
      count(*) filter (where phone_hash = ${phoneHash} and created_at > now() - make_interval(secs => ${OTP_LIMITS.cooldownSeconds}))::int as recent,
      count(*) filter (where phone_hash = ${phoneHash} and created_at > now() - interval '1 hour')::int as hour,
      count(*) filter (where phone_hash = ${phoneHash})::int as day,
      count(*) filter (where ${ip}::text is not null and ip = ${ip} and created_at > now() - interval '1 hour')::int as ip_hour
    from otp_requests
    where created_at > now() - interval '1 day'
      and (phone_hash = ${phoneHash} or (${ip}::text is not null and ip = ${ip}))`)
  const c = counts.rows[0]!
  if (c.recent > 0)
    return `Please wait ${OTP_LIMITS.cooldownSeconds} seconds before asking for another code.`
  if (c.hour >= OTP_LIMITS.perPhoneHour || c.day >= OTP_LIMITS.perPhoneDay)
    return "Too many codes for this number. Please try again later, or sign in with email."
  if (c.ip_hour >= OTP_LIMITS.perIpHour)
    return "Too many code requests from your network. Please try again later."
  await db.execute(sql`
    insert into otp_requests (phone_hash, ip) values (${phoneHash}, ${ip})`)
  // Keep the table small: nothing older than a day matters.
  await db.execute(
    sql`delete from otp_requests where created_at < now() - interval '1 day'`,
  )
  return null
}
