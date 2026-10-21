import "server-only"
import { sql } from "drizzle-orm"

import { getDb } from "./client"

/**
 * Whole-database invariants for stock and money (doc/06 Phase 7, race
 * campaign): whatever the timing of concurrent requests, the data must be in
 * a state that one-after-another requests could have produced. Checked by
 * the race tests and by `race-fixtures check` against a running stack.
 */
export const INVARIANTS: Record<string, ReturnType<typeof sql>> = {
  "reserved stock matches active reservations": sql`
    select count(*)::int as n from inventory_levels l
    where l.reserved <> coalesce((select sum(quantity) from inventory_reservations r
      where r.variant_id = l.variant_id and r.location_id = l.location_id and r.status = 'active'), 0)`,
  "stock on hand matches its movements": sql`
    select count(*)::int as n from inventory_levels l
    where l.on_hand <> coalesce((select sum(delta_on_hand) from inventory_movements m
      where m.variant_id = l.variant_id and m.location_id = l.location_id), 0)`,
  "stock is never negative or over-reserved": sql`
    select count(*)::int as n from inventory_levels where on_hand < 0 or reserved < 0 or reserved > on_hand`,
  "wallet balances match their ledgers": sql`
    select count(*)::int as n from wallet_accounts a
    where a.balance_paise <> coalesce((select sum(amount_paise) from wallet_ledger g where g.user_id = a.user_id), 0)
       or a.balance_paise < 0`,
  "wallet credit lots are never overspent": sql`
    select count(*)::int as n from wallet_credit_lots where remaining_paise < 0`,
  "coupon usage matches active redemptions": sql`
    select count(*)::int as n from coupons c
    where c.times_used <> (select count(*) from coupon_redemptions r where r.coupon_id = c.id and r.status = 'active')
       or (c.usage_limit is not null and c.times_used > c.usage_limit)`,
  "refunds never exceed the payment": sql`
    select count(*)::int as n from payments p
    where coalesce((select sum(amount_paise) from refunds f where f.payment_id = p.id and f.status <> 'failed'), 0) > p.amount_paise`,
  "confirmed orders hold no active reservations": sql`
    select count(*)::int as n from orders o
    where o.status <> 'pending_payment'
      and exists (select 1 from inventory_reservations r where r.order_id = o.id and r.status = 'active')`,
  "no money kept on a cancelled or expired order": sql`
    select count(*)::int as n from payments p join orders o on o.id = p.order_id
    where p.status in ('captured', 'partially_refunded') and p.purpose <> 'exchange_difference'
      and o.status in ('cancelled', 'expired')
      and coalesce((select sum(amount_paise) from refunds f where f.payment_id = p.id and f.status <> 'failed'), 0) < p.amount_paise`,
  "no order is charged twice": sql`
    select count(*)::int as n from (
      select p.order_id from payments p
      where p.status = 'captured' and p.purpose <> 'exchange_difference'
        and not exists (select 1 from refunds f where f.payment_id = p.id and f.status <> 'failed')
      group by p.order_id, p.purpose having count(*) > 1) d`,
}

/** The names of the invariants that don't hold, with how many rows break each. */
export async function brokenInvariants(): Promise<string[]> {
  const broken: string[] = []
  for (const [name, query] of Object.entries(INVARIANTS)) {
    const { rows } = await getDb().execute<{ n: number }>(query)
    if (rows[0]!.n > 0) broken.push(`${name} (${rows[0]!.n} rows)`)
  }
  return broken
}
