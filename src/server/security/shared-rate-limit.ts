import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"

/**
 * Rate limits shared by every web replica, kept in app_rate_limits (doc/06
 * Phase 8 audit). A fixed window per key: the first request of a window
 * starts it, and one atomic statement counts each request, so concurrent
 * requests on two replicas can't both slip under the limit.
 */
export type SharedLimit = { limit: number; windowMs: number }

/** Counts a request; false once the key is over its limit for this window. */
export async function hitLimit(
  key: string,
  { limit, windowMs }: SharedLimit,
): Promise<boolean> {
  const seconds = windowMs / 1000
  const { rows } = await getDb().execute<{ count: number }>(sql`
    insert into app_rate_limits as l (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when l.window_start <= now() - make_interval(secs => ${seconds}) then 1 else l.count + 1 end,
      window_start = case when l.window_start <= now() - make_interval(secs => ${seconds}) then now() else l.window_start end
    returning count`)
  // Now and then, drop counters nobody has touched for a day.
  if (Math.random() < 0.01) {
    await getDb().execute(
      sql`delete from app_rate_limits where window_start < now() - interval '1 day'`,
    )
  }
  return rows[0]!.count <= limit
}

/** Whether the key is already over its limit, without counting a request. */
export async function overLimit(
  key: string,
  { limit, windowMs }: SharedLimit,
): Promise<boolean> {
  const seconds = windowMs / 1000
  const { rows } = await getDb().execute<{ count: number }>(sql`
    select count from app_rate_limits
    where key = ${key} and window_start > now() - make_interval(secs => ${seconds})`)
  return (rows[0]?.count ?? 0) >= limit
}

export function rateLimited(message: string): DomainError {
  return new DomainError("RATE_LIMITED", message)
}

/** The limits (owner decision 2026-10-22: "balanced"). */
export const LIMITS = {
  searchSuggest: { limit: 60, windowMs: 60_000 },
  checkoutQuote: { limit: 60, windowMs: 60_000 },
  couponFailures: { limit: 10, windowMs: 60_000 },
  placeOrder: { limit: 5, windowMs: 10 * 60_000 },
} as const satisfies Record<string, SharedLimit>
