import "server-only"
import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { getDb } from "@/server/db/client"
import { queueEmail } from "@/server/notifications/email"

/**
 * inventory.low-stock-digest job (owner decision 2026-10-16): each morning,
 * one summary to active Store and Super Admins, only when a live SKU is at or
 * below its alert level. Staff can turn it off in the notification settings.
 */
export async function sendLowStockDigest(): Promise<number> {
  const db = getDb()
  const low = await db.execute<{
    title: string
    sku: string
    available: number
    total: number
  }>(sql`
    select p.title, v.sku::text as sku, (l.on_hand - l.reserved) as available,
           count(*) over ()::int as total
    from inventory_levels l
    join product_variants v on v.id = l.variant_id and v.status = 'active'
    join products p on p.id = v.product_id and p.status = 'active'
    where l.location_id = (select id from stock_locations where is_default)
      and l.on_hand - l.reserved <= coalesce(l.low_stock_threshold, 5)
    order by available, p.title
    limit 30`)
  if (low.rows.length === 0) return 0
  const recipients = await db.execute<{ id: string; email: string }>(sql`
    select id, email from users
    where coalesce(banned, false) = false and email_verified
      and regexp_split_to_array(trim(role), '\\s*,\\s*') && '{super_admin,store_admin}'::text[]`)
  const today = new Date().toLocaleDateString("en-CA", {
    timeZone: "Asia/Kolkata",
  })
  let sent = 0
  for (const recipient of recipients.rows) {
    const id = await queueEmail({
      template: "low-stock-digest",
      to: recipient.email,
      userId: recipient.id,
      reference: { type: "low_stock_digest", id: today },
      props: {
        url: new URL(
          "/admin/inventory?low=1",
          getServerEnv().APP_URL,
        ).toString(),
        total: low.rows[0]!.total,
        items: low.rows.map((r) => ({
          title: r.title,
          sku: r.sku,
          available: r.available,
        })),
      },
    })
    if (id) sent += 1
  }
  return sent
}
