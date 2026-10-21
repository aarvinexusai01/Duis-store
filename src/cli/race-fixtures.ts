import { randomBytes, randomUUID } from "node:crypto"

import { sql } from "drizzle-orm"

import { getServerEnv } from "@/config/env"
import { saveAddress } from "@/features/customers"
import { createDiscount } from "@/features/discounts"
import { adjustStock } from "@/features/inventory"
import { creditWallet } from "@/features/wallet"
import { systemActor, type UserActor } from "@/server/auth/actor"
import { getAuth } from "@/server/auth/auth"
import { closeDb, getDb } from "@/server/db/client"
import { brokenInvariants } from "@/server/db/invariants"
import { withTransaction } from "@/server/db/transaction"
import { stopSender } from "@/server/jobs/enqueue"

/**
 * Fixtures for the HTTP race suite (tests/race), run inside the stack:
 *   ops/compose run --rm --no-deps web_a node dist/race-fixtures.mjs <command>
 *
 *   customers <count> [creditPaise]  verified customers with a saved address
 *   stock <units>                    a live product variant with exactly <units>
 *   coupon <uses>                    a ₹100-off coupon limited to <uses>
 *   orders <variantId>               how that variant's orders ended up
 *   order <orderNumber>              one order's status, confirmations, emails, refunds
 *   check                            the stock and money invariants
 *
 * Prints JSON. Refused unless the fake payment provider is configured, which
 * production never allows (config/env.ts): it creates accounts and credit.
 */

const actor = systemActor("race-fixtures")

async function customers(count: number, creditPaise: number) {
  const created: { email: string; password: string }[] = []
  for (let i = 0; i < count; i += 1) {
    const email = `race-${randomUUID().slice(0, 12)}@duis.test`
    const password = randomBytes(12).toString("base64url")
    const { user } = await getAuth().api.createUser({
      body: { email, password, name: `Race Buyer ${i + 1}`, role: "customer" },
    })
    await getDb().execute(
      sql`update users set email_verified = true where id = ${user.id}`,
    )
    const customer: UserActor = {
      kind: "user",
      userId: user.id,
      roles: ["customer"],
      twoFactorEnabled: false,
      requestId: "race-fixtures",
      ip: null,
    }
    await saveAddress(customer, {
      fullName: `Race Buyer ${i + 1}`,
      phone: "9876543210",
      line1: "12 Hazratganj",
      city: "Lucknow",
      stateCode: "IN-UP",
      postalCode: "226001",
      countryCode: "IN",
    })
    if (creditPaise > 0) {
      await withTransaction((tx) =>
        creditWallet(tx, {
          userId: user.id,
          amountPaise: creditPaise,
          reason: "goodwill",
          idempotencyKey: `race:${randomUUID()}`,
        }),
      )
    }
    created.push({ email, password })
  }
  return created
}

/** Picks a live variant with nothing reserved and sets its stock exactly. */
async function stock(units: number) {
  const { rows } = await getDb().execute<{
    variant_id: string
    slug: string
    on_hand: number
    price_paise: number
    options: Record<string, string>
  }>(sql`
    select v.id as variant_id, p.slug::text, l.on_hand, v.price_paise,
           (select json_object_agg(a.code, av.slug) from variant_attribute_values vav
            join attributes a on a.id = vav.attribute_id
            join attribute_values av on av.id = vav.attribute_value_id
            where vav.variant_id = v.id) as options
    from product_variants v
    join products p on p.id = v.product_id and p.status = 'active'
    join inventory_levels l on l.variant_id = v.id
    where v.status = 'active' and l.reserved = 0 and l.on_hand > 0
      and v.price_paise between 50000 and 99800
      and not exists (select 1 from order_items oi where oi.variant_id = v.id)
    order by random() limit 1`)
  const pick = rows[0]
  if (!pick) throw new Error("no unused live variant left; reseed the stack")
  if (units !== pick.on_hand) {
    await adjustStock(actor, {
      variantId: pick.variant_id,
      delta: units - pick.on_hand,
      reason: "count_correction",
    })
  }
  return {
    variantId: pick.variant_id,
    slug: pick.slug,
    options: pick.options,
    pricePaise: pick.price_paise,
  }
}

async function coupon(uses: number) {
  const code = `RACE${randomBytes(4).toString("hex").toUpperCase()}`
  await createDiscount(actor, {
    name: code,
    kind: "coupon",
    code,
    valueType: "fixed",
    value: 10_000,
    usageLimitTotal: uses,
  })
  return { code }
}

async function orders(variantId: string) {
  const { rows } = await getDb().execute<{
    status: string
    n: number
  }>(sql`
    select o.status::text, count(*)::int as n from orders o
    where exists (select 1 from order_items oi where oi.order_id = o.id and oi.variant_id = ${variantId})
    group by o.status order by 1`)
  return Object.fromEntries(rows.map((r) => [r.status, r.n]))
}

async function order(orderNumber: string) {
  const { rows } = await getDb().execute<{
    status: string
    confirmations: number
    emails: number
    refunds: number
    captured: number
  }>(sql`
    select o.status::text,
      (select count(*)::int from order_status_history h where h.order_id = o.id and h.field = 'status' and h.to_value = 'confirmed') as confirmations,
      (select count(*)::int from notification_logs n where n.reference_id = o.id::text and n.template = 'order-confirmed') as emails,
      (select count(*)::int from refunds r where r.order_id = o.id) as refunds,
      (select count(*)::int from payments p where p.order_id = o.id and p.status = 'captured') as captured
    from orders o where o.order_number = ${orderNumber}`)
  return rows[0] ?? null
}

async function main(): Promise<unknown> {
  const env = getServerEnv()
  if (env.PAYMENT_PROVIDER !== "fake" || env.APP_ENV === "production") {
    throw new Error("race fixtures only run against a fake-payment stack")
  }
  const [command, ...args] = process.argv.slice(2)
  switch (command) {
    case "customers":
      return customers(Number(args[0] ?? 1), Number(args[1] ?? 0))
    case "stock":
      return stock(Number(args[0] ?? 1))
    case "coupon":
      return coupon(Number(args[0] ?? 1))
    case "orders":
      return orders(args[0]!)
    case "order":
      return order(args[0]!)
    case "check":
      return { broken: await brokenInvariants() }
    default:
      throw new Error(`unknown command ${command ?? "(none)"}`)
  }
}

main()
  .then(async (result) => {
    process.stdout.write(`${JSON.stringify(result)}\n`)
    await stopSender()
    await closeDb()
  })
  .catch(async (error: unknown) => {
    process.stderr.write(`${String(error)}\n`)
    await stopSender().catch(() => {})
    await closeDb().catch(() => {})
    process.exit(1)
  })
