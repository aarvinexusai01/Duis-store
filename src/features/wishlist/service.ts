import "server-only"
import { and, desc, eq, sql } from "drizzle-orm"
import { z } from "zod"

import { wishlistItems } from "@/db/schema"
import { getDb } from "@/server/db/client"
import { DomainError } from "@/server/errors"
import { defineOperation } from "@/server/operation"

/** Wishlists need an account (doc/01): a guest is sent to sign in first. */

const MAX_ITEMS = 200

function userId(actor: { kind: string; userId?: string }): string {
  if (actor.kind !== "user" || !actor.userId) {
    throw new DomainError("UNAUTHENTICATED", "Please sign in to continue.")
  }
  return actor.userId
}

export const addWishlistItem = defineOperation({
  name: "wishlist.add",
  access: "authenticated",
  input: z.object({ productId: z.uuid() }),
  async handler({ actor }, { productId }) {
    const owner = userId(actor)
    const result = await getDb().execute(sql`
      insert into wishlist_items (user_id, product_id)
      select ${owner}, p.id from products p
      where p.id = ${productId} and p.status = 'active'
        and (select count(*) from wishlist_items where user_id = ${owner}) < ${MAX_ITEMS}
      on conflict do nothing`)
    if (result.rowCount === 0) {
      const exists = await getDb()
        .select({ productId: wishlistItems.productId })
        .from(wishlistItems)
        .where(
          and(
            eq(wishlistItems.userId, owner),
            eq(wishlistItems.productId, productId),
          ),
        )
      if (exists.length === 0) {
        throw new DomainError(
          "CONFLICT",
          "This product can't be saved right now (it may be unavailable, or your wishlist is full).",
        )
      }
    }
  },
})

export const removeWishlistItem = defineOperation({
  name: "wishlist.remove",
  access: "authenticated",
  input: z.object({ productId: z.uuid() }),
  async handler({ actor }, { productId }) {
    await getDb()
      .delete(wishlistItems)
      .where(
        and(
          eq(wishlistItems.userId, userId(actor)),
          eq(wishlistItems.productId, productId),
        ),
      )
  },
})

/** Saved product ids, newest first (inactive products included; the page filters). */
export const listWishlist = defineOperation({
  name: "wishlist.list",
  access: "authenticated",
  input: z.object({}),
  async handler({ actor }): Promise<string[]> {
    const rows = await getDb()
      .select({ productId: wishlistItems.productId })
      .from(wishlistItems)
      .where(eq(wishlistItems.userId, userId(actor)))
      .orderBy(desc(wishlistItems.createdAt))
    return rows.map((row) => row.productId)
  },
})
