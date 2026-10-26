import "server-only"
import { sql } from "drizzle-orm"
import { z } from "zod"

import { STORE_POLICY } from "@/config/store-policy"
import { loadStorePolicy } from "@/features/settings"
import type { MediaRef } from "@/features/catalog"
import type { Actor } from "@/server/auth/actor"
import { getDb } from "@/server/db/client"
import { withTransaction, type Transaction } from "@/server/db/transaction"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"
import { hashToken, newToken, TOKEN_PATTERN } from "@/server/security/tokens"

/**
 * Carts (doc/03 §1). A guest cart is found by the hash of a random cookie
 * token; a customer's by their user id. Prices are never stored here: every
 * read uses the live variant price, and checkout (Phase 3) re-prices again.
 */

const MAX_LINES = 50
const MAX_QUANTITY = STORE_POLICY.maxQuantityPerLine

export type CartLineIssue = "unavailable" | "sold_out" | "insufficient_stock"

export type CartLine = {
  variantId: string
  productId: string
  productSlug: string
  title: string
  sku: string
  options: { name: string; value: string }[]
  image: MediaRef | null
  quantity: number
  unitPricePaise: number
  unitMrpPaise: number
  available: number
  issue: CartLineIssue | null
}

export type CartView = {
  lines: CartLine[]
  itemCount: number
  subtotalPaise: number
  mrpTotalPaise: number
  savingsPaise: number
  amountToFreeShippingPaise: number
  hasIssues: boolean
}

const guestToken = z.string().regex(TOKEN_PATTERN).optional()

type Db = Transaction | ReturnType<typeof getDb>

/** The caller's active cart id, if any (no writes). */
async function findCartId(
  db: Db,
  actor: Actor,
  token: string | undefined,
  lock = false,
): Promise<string | null> {
  const forUpdate = lock ? sql`for update` : sql``
  const result =
    actor.kind === "user"
      ? await db.execute<{ id: string }>(sql`
          select id from carts
          where user_id = ${actor.userId} and status = 'active' ${forUpdate}`)
      : token
        ? await db.execute<{ id: string }>(sql`
            select id from carts
            where anonymous_token_hash = ${hashToken(token)}
              and user_id is null and status = 'active' ${forUpdate}`)
        : { rows: [] }
  return result.rows[0]?.id ?? null
}

/** Finds or creates the caller's cart; returns a new token for new guests. */
async function ensureCart(
  tx: Transaction,
  actor: Actor,
  token: string | undefined,
): Promise<{ cartId: string; newGuestToken?: string }> {
  const existing = await findCartId(tx, actor, token, true)
  if (existing) return { cartId: existing }

  if (actor.kind === "user") {
    const created = await tx.execute<{ id: string }>(sql`
      insert into carts (user_id) values (${actor.userId})
      on conflict (user_id) where status = 'active' and user_id is not null
      do nothing
      returning id`)
    const cartId =
      created.rows[0]?.id ?? (await findCartId(tx, actor, undefined, true))
    if (!cartId) throw new Error("cart could not be created")
    return { cartId }
  }

  const fresh = newToken()
  const created = await tx.execute<{ id: string }>(sql`
    insert into carts (anonymous_token_hash) values (${hashToken(fresh)})
    returning id`)
  return { cartId: created.rows[0]!.id, newGuestToken: fresh }
}

type VariantState = { purchasable: boolean; available: number }

async function variantState(db: Db, variantId: string): Promise<VariantState> {
  const result = await db.execute<{
    purchasable: boolean
    available: number
  }>(sql`
    select (v.status = 'active' and p.status = 'active') as purchasable,
           coalesce((
             select sum(l.on_hand - l.reserved)
             from inventory_levels l
             join stock_locations loc on loc.id = l.location_id and loc.is_active
             where l.variant_id = v.id
           ), 0)::int as available
    from product_variants v
    join products p on p.id = v.product_id
    where v.id = ${variantId}`)
  const row = result.rows[0]
  if (!row)
    throw new DomainError("NOT_FOUND", "This product is no longer available.")
  return row
}

function stockError(available: number): DomainError {
  return new DomainError(
    "OUT_OF_STOCK",
    available <= 0
      ? "Sorry, this size is sold out."
      : `Only ${available} left in this size.`,
    { available },
  )
}

async function setQuantity(
  tx: Transaction,
  cartId: string,
  variantId: string,
  quantity: number,
): Promise<void> {
  if (quantity === 0) {
    await tx.execute(sql`
      delete from cart_items where cart_id = ${cartId} and variant_id = ${variantId}`)
  } else {
    await tx.execute(sql`
      insert into cart_items (cart_id, variant_id, quantity)
      values (${cartId}, ${variantId}, ${quantity})
      on conflict (cart_id, variant_id)
      do update set quantity = excluded.quantity, updated_at = now()`)
  }
  await tx.execute(sql`
    update carts set last_activity_at = now(), updated_at = now() where id = ${cartId}`)
}

async function currentQuantity(
  tx: Transaction,
  cartId: string,
  variantId: string,
): Promise<{ quantity: number; lines: number }> {
  const result = await tx.execute<{
    quantity: number | null
    lines: number
  }>(sql`
    select (select quantity from cart_items where cart_id = ${cartId} and variant_id = ${variantId}) as quantity,
           (select count(*)::int from cart_items where cart_id = ${cartId}) as lines`)
  const row = result.rows[0]!
  return { quantity: row.quantity ?? 0, lines: row.lines }
}

// --- Operations ------------------------------------------------------------------

export const addCartItem = defineOperation({
  name: "cart.addItem",
  access: "public",
  input: z.object({
    guestToken,
    variantId: z.uuid(),
    quantity: z.number().int().min(1).max(MAX_QUANTITY),
  }),
  async handler({ actor }, { guestToken: token, variantId, quantity }) {
    return withTransaction(async (tx) => {
      const { cartId, newGuestToken } = await ensureCart(tx, actor, token)
      const state = await variantState(tx, variantId)
      if (!state.purchasable) {
        throw new DomainError(
          "NOT_FOUND",
          "This product is no longer available.",
        )
      }
      const current = await currentQuantity(tx, cartId, variantId)
      if (current.quantity === 0 && current.lines >= MAX_LINES) {
        throw new DomainError(
          "CONFLICT",
          `Your bag can hold up to ${MAX_LINES} different items.`,
        )
      }
      const next = current.quantity + quantity
      if (next > MAX_QUANTITY) {
        throw new DomainError(
          "CONFLICT",
          `You can buy up to ${MAX_QUANTITY} of each item.`,
        )
      }
      if (next > state.available) throw stockError(state.available)
      await setQuantity(tx, cartId, variantId, next)
      return { newGuestToken, quantity: next }
    })
  },
})

export const updateCartItem = defineOperation({
  name: "cart.updateItem",
  access: "public",
  input: z.object({
    guestToken,
    variantId: z.uuid(),
    // 0 removes the line.
    quantity: z.number().int().min(0).max(MAX_QUANTITY),
  }),
  async handler({ actor }, { guestToken: token, variantId, quantity }) {
    await withTransaction(async (tx) => {
      const cartId = await findCartId(tx, actor, token, true)
      if (!cartId) throw new DomainError("NOT_FOUND", "Your bag is empty.")
      const current = await currentQuantity(tx, cartId, variantId)
      if (current.quantity === 0) {
        throw new DomainError("NOT_FOUND", "That item is not in your bag.")
      }
      // Lowering a quantity or removing is always allowed; raising it needs
      // the stock to be there.
      if (quantity > current.quantity) {
        const state = await variantState(tx, variantId)
        if (!state.purchasable) {
          throw new DomainError(
            "NOT_FOUND",
            "This product is no longer available.",
          )
        }
        if (quantity > state.available) throw stockError(state.available)
      }
      await setQuantity(tx, cartId, variantId, quantity)
    })
  },
})

export const getCart = defineOperation({
  name: "cart.get",
  access: "public",
  input: z.object({ guestToken }),
  async handler({ actor }, { guestToken: token }): Promise<CartView> {
    const db = getDb()
    const cartId = await findCartId(db, actor, token)
    // Every page's header asks, mostly for visitors with no bag: answer
    // those without a query (ADR-0033). The free-shipping nudge only shows
    // with items in the bag.
    if (!cartId) return buildView([], 0)
    const [lines, policy] = await Promise.all([
      loadLines(db, cartId),
      loadStorePolicy(),
    ])
    return buildView(lines, policy.freeShippingThresholdPaise)
  },
})

/**
 * Moves a guest cart into the signed-in customer's cart (doc/03 §1): the
 * guest cart is adopted if the customer has none, otherwise its lines are
 * added (capped at the per-line maximum) and it is marked merged. Running it
 * twice is harmless.
 */
export const mergeGuestCart = defineOperation({
  name: "cart.mergeGuest",
  access: "authenticated",
  input: z.object({ guestToken: z.string().regex(TOKEN_PATTERN) }),
  async handler({ actor, log }, { guestToken: token }) {
    if (actor.kind !== "user") return { merged: 0 }
    return withTransaction(async (tx) => {
      const guestId = await findCartId(
        tx,
        { kind: "anonymous", requestId: actor.requestId, ip: actor.ip },
        token,
        true,
      )
      if (!guestId) return { merged: 0 }

      const userCartId = await findCartId(tx, actor, undefined, true)
      if (!userCartId) {
        await tx.execute(sql`
          update carts
          set user_id = ${actor.userId}, anonymous_token_hash = null,
              last_activity_at = now(), updated_at = now()
          where id = ${guestId}`)
        log.info("guest cart adopted at sign-in")
        return { merged: -1 }
      }

      const merged = await tx.execute(sql`
        insert into cart_items (cart_id, variant_id, quantity)
        select ${userCartId}, g.variant_id, least(g.quantity, ${MAX_QUANTITY})
        from cart_items g where g.cart_id = ${guestId}
        on conflict (cart_id, variant_id) do update
          set quantity = least(cart_items.quantity + excluded.quantity, ${MAX_QUANTITY}),
              updated_at = now()`)
      await tx.execute(sql`
        update carts set status = 'merged', updated_at = now() where id = ${guestId}`)
      await tx.execute(sql`
        update carts set last_activity_at = now(), updated_at = now() where id = ${userCartId}`)
      log.info({ lines: merged.rowCount }, "guest cart merged at sign-in")
      return { merged: merged.rowCount ?? 0 }
    })
  },
})

// --- Reading ---------------------------------------------------------------------

type LineRow = {
  variant_id: string
  quantity: number
  sku: string
  price_paise: number
  mrp_paise: number
  purchasable: boolean
  product_id: string
  slug: string
  title: string
  available: number
  options: { name: string; value: string }[] | null
  image_key: string | null
  image_width: number | null
  image_height: number | null
  image_alt: string | null
}

async function loadLines(db: Db, cartId: string): Promise<CartLine[]> {
  const result = await db.execute<LineRow>(sql`
    select ci.variant_id, ci.quantity, v.sku::text, v.price_paise, v.mrp_paise,
           (v.status = 'active' and p.status = 'active') as purchasable,
           p.id as product_id, p.slug::text, p.title,
           coalesce(stock.available, 0)::int as available,
           (select json_agg(json_build_object('name', a.name, 'value', av.label) order by pa.position, a.code)
            from variant_attribute_values vav
            join attributes a on a.id = vav.attribute_id
            join attribute_values av on av.id = vav.attribute_value_id
            left join product_attributes pa on pa.product_id = p.id and pa.attribute_id = a.id
            where vav.variant_id = v.id) as options,
           img.storage_key as image_key, img.width as image_width,
           img.height as image_height, img.alt_text as image_alt
    from cart_items ci
    join product_variants v on v.id = ci.variant_id
    join products p on p.id = v.product_id
    left join lateral (
      select sum(l.on_hand - l.reserved) as available
      from inventory_levels l
      join stock_locations loc on loc.id = l.location_id and loc.is_active
      where l.variant_id = v.id
    ) stock on true
    left join lateral (
      select m.storage_key, m.width, m.height, coalesce(pm.alt_override, m.alt_text) as alt_text
      from product_media pm
      join media_assets m on m.id = pm.media_id and m.deleted_at is null
      where pm.product_id = p.id
        and (pm.color_value_id is null or pm.color_value_id in (
          select attribute_value_id from variant_attribute_values where variant_id = v.id))
      order by (pm.color_value_id is null), pm.position
      limit 1
    ) img on true
    where ci.cart_id = ${cartId}
    order by ci.created_at, ci.variant_id`)

  return result.rows.map((row) => ({
    variantId: row.variant_id,
    productId: row.product_id,
    productSlug: row.slug,
    title: row.title,
    sku: row.sku,
    options: row.options ?? [],
    image:
      row.image_key && row.image_width && row.image_height
        ? {
            key: row.image_key,
            width: row.image_width,
            height: row.image_height,
            alt: row.image_alt ?? row.title,
          }
        : null,
    quantity: row.quantity,
    unitPricePaise: row.price_paise,
    unitMrpPaise: row.mrp_paise,
    available: Math.max(0, row.available),
    issue: !row.purchasable
      ? "unavailable"
      : row.available <= 0
        ? "sold_out"
        : row.quantity > row.available
          ? "insufficient_stock"
          : null,
  }))
}

/** Totals count only lines that can be bought as they stand. */
export function buildView(
  lines: CartLine[],
  freeShippingThresholdPaise: number,
): CartView {
  const buyable = lines.filter((line) => line.issue === null)
  const subtotalPaise = buyable.reduce(
    (sum, line) => sum + line.unitPricePaise * line.quantity,
    0,
  )
  const mrpTotalPaise = buyable.reduce(
    (sum, line) =>
      sum + Math.max(line.unitMrpPaise, line.unitPricePaise) * line.quantity,
    0,
  )
  return {
    lines,
    itemCount: lines.reduce((sum, line) => sum + line.quantity, 0),
    subtotalPaise,
    mrpTotalPaise,
    savingsPaise: mrpTotalPaise - subtotalPaise,
    amountToFreeShippingPaise: Math.max(
      0,
      freeShippingThresholdPaise - subtotalPaise,
    ),
    hasIssues: lines.some((line) => line.issue !== null),
  }
}
