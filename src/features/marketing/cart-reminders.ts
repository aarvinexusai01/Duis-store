import "server-only"
import { createHmac, timingSafeEqual } from "node:crypto"

import { sql } from "drizzle-orm"
import { z } from "zod"

import { getServerEnv } from "@/config/env"
import { getDb } from "@/server/db/client"
import { withTransaction } from "@/server/db/transaction"
import { queueEmail } from "@/server/notifications/email"
import { defineOperation } from "@/server/operation"

/**
 * Abandoned-bag reminders (doc/06 Phase 5 §7, doc/10 P15): for signed-in
 * customers with marketing email consent, a bag idle for an hour gets one
 * email and, still untouched a day later, a second; never more. New
 * activity starts a fresh cycle. Skipped if they ordered since.
 */

const BATCH = 200

/** Signed one-click unsubscribe link (no sign-in needed). */
export function marketingUnsubscribeToken(userId: string): string {
  return createHmac("sha256", getServerEnv().BETTER_AUTH_SECRET)
    .update(`unsubscribe:${userId}`)
    .digest("base64url")
    .slice(0, 22)
}

export function marketingUnsubscribeUrl(userId: string): string {
  const url = new URL("/unsubscribe", getServerEnv().APP_URL)
  url.searchParams.set("u", userId)
  url.searchParams.set("t", marketingUnsubscribeToken(userId))
  return url.toString()
}

export async function sendCartReminders(): Promise<number> {
  const due = await getDb().execute<{
    cart_id: string
    user_id: string
    name: string
    email: string
    fresh: boolean
  }>(sql`
    select c.id as cart_id, c.user_id, u.name, u.email,
           (c.last_reminded_at is null or c.last_reminded_at < c.last_activity_at) as fresh
    from carts c
    join users u on u.id = c.user_id
    join customer_profiles cp on cp.user_id = u.id
    where c.status = 'active' and cp.marketing_email_consent_at is not null
      and u.email not like '%.invalid'
      and exists (select 1 from cart_items ci where ci.cart_id = c.id)
      and not exists (select 1 from orders o where o.user_id = c.user_id
                      and o.placed_at >= c.last_activity_at and o.status <> 'expired')
      and (
        ((c.last_reminded_at is null or c.last_reminded_at < c.last_activity_at)
          and c.last_activity_at < now() - interval '1 hour')
        or (c.reminder_count = 1 and c.last_reminded_at >= c.last_activity_at
          and c.last_activity_at < now() - interval '24 hours')
      )
    order by c.last_activity_at limit ${BATCH}`)
  let sent = 0
  for (const cart of due.rows) {
    await withTransaction(async (tx) => {
      // Claim the cart for this reminder (another worker may race us).
      const claimed = await tx.execute<{ id: string }>(sql`
        update carts set
          reminder_count = case when ${cart.fresh} then 1 else reminder_count + 1 end,
          last_reminded_at = now()
        where id = ${cart.cart_id}
          and (${cart.fresh} or (reminder_count = 1 and last_reminded_at >= last_activity_at))
        returning id`)
      if (!claimed.rows[0]) return
      const items = await tx.execute<{ title: string }>(sql`
        select p.title from cart_items ci
        join product_variants v on v.id = ci.variant_id
        join products p on p.id = v.product_id
        where ci.cart_id = ${cart.cart_id} and p.status = 'active'
        order by ci.created_at desc limit 3`)
      if (items.rows.length === 0) return
      await queueEmail(
        {
          template: "cart-reminder",
          to: cart.email,
          userId: cart.user_id,
          reference: { type: "cart", id: cart.cart_id },
          props: {
            name: cart.name,
            items: items.rows.map((i) => i.title),
            url: new URL("/cart", getServerEnv().APP_URL).toString(),
            unsubscribeUrl: marketingUnsubscribeUrl(cart.user_id),
          },
        },
        { tx },
      )
      sent += 1
    })
  }
  return sent
}

/** One-click unsubscribe from marketing email (signed link). */
export const unsubscribeMarketing = defineOperation({
  name: "marketing.unsubscribe",
  access: "public",
  input: z.object({
    userId: z.uuid(),
    token: z.string().max(40),
  }),
  async handler(_ctx, { userId, token }) {
    const expected = Buffer.from(marketingUnsubscribeToken(userId))
    const given = Buffer.from(token)
    if (given.length !== expected.length || !timingSafeEqual(given, expected))
      return { done: false }
    await getDb().execute(sql`
      update customer_profiles set marketing_email_consent_at = null, updated_at = now()
      where user_id = ${userId}`)
    return { done: true }
  },
})
