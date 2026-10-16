import { randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"

import { getDb } from "@/server/db/client"

import { createUserActor } from "./actors"

let owner: string | null = null

/**
 * A minimal pending order to hold stock reservations in inventory tests
 * (reservations reference orders since Phase 3). Totals are zero and valid.
 */
export async function placeholderOrderId(): Promise<string> {
  if (!owner) {
    const actor = await createUserActor("customer")
    owner = actor.kind === "user" ? actor.userId : null
  }
  const result = await getDb().execute<{ id: string }>(sql`
    insert into orders (user_id, payment_mode, destination_country, subtotal_paise, total_paise,
                        online_amount_paise, shipping_address, customer_name, place_idempotency_key,
                        quote, quote_hash)
    values (${owner}, 'prepaid', 'IN', 0, 0, 0, '{}'::jsonb, 'Test', ${`test:${randomUUID()}`},
            '{}'::jsonb, 'test')
    returning id`)
  return result.rows[0]!.id
}
